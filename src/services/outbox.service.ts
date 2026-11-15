import { env } from '../config/env';
import { logger } from '../config/logger';
import { withTransaction } from '../database/pool';
import {
  DeliveryContext,
  emailDeliveryRepository,
} from '../repositories/emailDelivery.repository';
import { activityRepository } from '../repositories/activity.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { isHostMessage } from '../types/emailDelivery.types';
import { reminderScheduledFor } from '../utils/date.util';
import { renderDelivery, sendMail } from './email.service';

/**
 * Worker da outbox.
 *
 * O envio acontece sempre fora do pedido HTTP. Cada linha é reservada
 * com `FOR UPDATE SKIP LOCKED` (várias instâncias podem correr em
 * paralelo), o contexto é recarregado imediatamente antes do envio e
 * o estado actual do evento/convite decide se a mensagem ainda faz
 * sentido. A chave idempotente impede duplicados quando o scheduler
 * corre outra vez.
 */

export interface OutboxResult {
  recovered: number;
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  cancelled: number;
}

type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Decide se uma entrega ainda é aplicável.
 *
 * Exportada para testes unitários: é aqui que vivem as regras que
 * impedem lembretes após uma recusa, emails de eventos cancelados e
 * marcos obsoletos depois de uma alteração de data.
 */
export function evaluateApplicability(context: DeliveryContext): Verdict {
  if (context.messageType === 'manage_link') {
    return { ok: false, reason: 'manage_link_not_queued' };
  }

  // Mensagens de conta não dependem do estado de um evento.
  if (isHostMessage(context.messageType)) {
    return { ok: true };
  }

  // Enquanto o evento estiver em `draft` não está pronto: convites e
  // lembretes não podem sair. Avisos operacionais (recusa) continuam a
  // ser entregues ao anfitrião.
  if (
    context.eventStatus === 'draft' &&
    (context.messageType === 'invitation' || context.messageType === 'reminder')
  ) {
    return { ok: false, reason: 'event_draft' };
  }

  if (
    context.messageType !== 'event_cancelled' &&
    (context.eventStatus === 'cancelled' || context.eventStatus === 'completed')
  ) {
    return { ok: false, reason: `event_${context.eventStatus}` };
  }

  if (context.messageType === 'event_cancelled') {
    return { ok: true };
  }

  if (context.messageType === 'decline_notification') {
    return { ok: true };
  }

  if (!context.invitationId) {
    return { ok: false, reason: 'missing_invitation' };
  }

  if (context.rsvpStatus === 'declined') {
    return { ok: false, reason: 'invitation_declined' };
  }

  if (context.claimRevokedAt) {
    return { ok: false, reason: 'claim_revoked' };
  }

  if (context.messageType === 'reminder') {
    const offset = Number.parseInt((context.reminderKind ?? '').replace('d', ''), 10);

    if (!Number.isInteger(offset) || offset <= 0) {
      return { ok: false, reason: 'invalid_reminder_kind' };
    }

    if (!context.eventStartsAt || !context.eventTimezone) {
      return { ok: false, reason: 'missing_event_context' };
    }

    const expected = reminderScheduledFor(
      context.eventStartsAt,
      context.eventTimezone,
      offset,
      env.REMINDER_LOCAL_HOUR
    );

    if (Math.abs(expected.getTime() - context.scheduledFor.getTime()) > 60_000) {
      return { ok: false, reason: 'obsolete_reminder' };
    }
  }

  return { ok: true };
}

async function processDelivery(context: DeliveryContext, result: OutboxResult): Promise<void> {
  const fresh = await emailDeliveryRepository.findContextById(context.id);

  if (!fresh) {
    await emailDeliveryRepository.markCancelled(context.id, 'delivery_missing');
    result.cancelled += 1;
    return;
  }

  const verdict = evaluateApplicability(fresh);

  if (!verdict.ok) {
    await emailDeliveryRepository.markCancelled(fresh.id, verdict.reason);
    result.cancelled += 1;
    return;
  }

  try {
    const message = renderDelivery(fresh);
    const { providerMessageId } = await sendMail(message);

    await emailDeliveryRepository.markSent(fresh.id, providerMessageId);

    if (fresh.messageType === 'invitation' && fresh.invitationId) {
      await invitationRepository.setSendStatus(fresh.invitationId, 'sent', {
        incrementCount: true,
      });
    }

    if (fresh.messageType === 'reminder' && fresh.eventId && fresh.invitationId) {
      // O email já saiu: uma falha ao registar a actividade não pode
      // provocar um reenvio (duplicado). Fica apenas no log.
      await activityRepository
        .create({
          eventId: fresh.eventId,
          invitationId: fresh.invitationId,
          kind: 'reminder_sent',
          guestName: fresh.guestName,
          metadata: { reminder_kind: fresh.reminderKind },
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: error, deliveryId: fresh.id },
            'Falha ao registar actividade de lembrete enviado.'
          );
        });
    }

    result.sent += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido no envio.';
    logger.error(
      { err: error, deliveryId: fresh.id, messageType: fresh.messageType },
      'Falha ao enviar email da outbox.'
    );

    if (fresh.attempts >= env.EMAIL_MAX_ATTEMPTS) {
      await emailDeliveryRepository.markFailed(fresh.id, message, null);

      if (fresh.messageType === 'invitation' && fresh.invitationId) {
        await invitationRepository.setSendStatus(fresh.invitationId, 'failed');
      }

      result.failed += 1;
      return;
    }

    const delay = env.EMAIL_RETRY_BASE_MS * 2 ** Math.max(0, fresh.attempts - 1);
    await emailDeliveryRepository.markFailed(fresh.id, message, new Date(Date.now() + delay));
    result.retried += 1;
  }
}

/** Processa um lote de entregas vencidas. */
export async function processOutbox(limit = 50): Promise<OutboxResult> {
  const result: OutboxResult = {
    recovered: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    cancelled: 0,
  };

  result.recovered = await emailDeliveryRepository.recoverStaleProcessing(10);

  const batch = await withTransaction((client) => emailDeliveryRepository.claimDue(limit, client));
  result.claimed = batch.length;

  for (const delivery of batch) {
    await processDelivery(delivery, result);
  }

  if (result.recovered > 0) {
    logger.warn({ recovered: result.recovered }, 'Entregas presas em processing recuperadas.');
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;
let cycleRunning = false;

async function runCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    const result = await processOutbox();

    if (result.sent > 0 || result.failed > 0 || result.cancelled > 0 || result.retried > 0) {
      logger.info(result, 'Ciclo da outbox concluído.');
    }
  } catch (error) {
    logger.error({ err: error }, 'Falha no ciclo da outbox.');
  } finally {
    cycleRunning = false;
  }
}

/** Inicia o agendador periódico (uma vez por processo). */
export function startOutboxScheduler(): void {
  if (timer) return;

  timer = setInterval(() => {
    void runCycle();
  }, env.OUTBOX_SCAN_INTERVAL_MS);

  timer.unref();

  logger.info(
    {
      intervalMs: env.OUTBOX_SCAN_INTERVAL_MS,
      offsets: env.REMINDER_OFFSETS_DAYS,
      localHour: env.REMINDER_LOCAL_HOUR,
    },
    'Agendador da outbox iniciado.'
  );

  void runCycle();
}

export function stopOutboxScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('Agendador da outbox parado.');
}
