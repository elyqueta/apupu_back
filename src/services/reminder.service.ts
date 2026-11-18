import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { env } from '../config/env';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { Event } from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import { buildReminderSchedule } from '../utils/date.util';
import { encryptToken } from '../utils/crypto.util';

/**
 * Agendamento de mensagens na outbox.
 *
 * Nenhuma destas funções envia email: apenas registam entregas
 * idempotentes. O worker (`outbox.service.ts`) é quem envia e volta a
 * validar o estado antes de o fazer.
 */

function isSuppressed(invitation: Invitation): boolean {
  return invitation.rsvpStatus === 'declined' || invitation.claimRevokedAt !== null;
}

/** Enfileira o convite inicial de um convidado. */
export async function enqueueInvitationEmail(
  event: Event,
  invitation: Invitation,
  options: { resend?: boolean } = {},
  client?: PoolClient
): Promise<void> {
  const key = options.resend
    ? `invitation:${invitation.id}:resend:${randomUUID()}`
    : `invitation:${invitation.id}:initial`;

  await emailDeliveryRepository.enqueue(
    {
      eventId: event.id,
      invitationId: invitation.id,
      messageType: 'invitation',
      reminderKind: null,
      recipientEmail: invitation.guestEmail,
      scheduledFor: new Date(),
      idempotencyKey: key,
    },
    client
  );
}

/** Enfileira os marcos futuros de um convidado. */
export async function enqueueRemindersForInvitation(
  event: Event,
  invitation: Invitation,
  client?: PoolClient,
  options: { keySuffix?: string } = {}
): Promise<void> {
  if (isSuppressed(invitation)) return;

  const schedule = buildReminderSchedule(
    event.startsAt,
    event.timezone,
    env.REMINDER_OFFSETS_DAYS,
    env.REMINDER_LOCAL_HOUR
  );
  const suffix = options.keySuffix ? `:${options.keySuffix}` : '';

  for (const reminder of schedule) {
    await emailDeliveryRepository.enqueue(
      {
        eventId: event.id,
        invitationId: invitation.id,
        messageType: 'reminder',
        reminderKind: reminder.kind,
        recipientEmail: invitation.guestEmail,
        scheduledFor: reminder.scheduledFor,
        idempotencyKey: `reminder:${invitation.id}:${reminder.scheduledFor.toISOString()}${suffix}`,
      },
      client
    );
  }
}

/** Convite inicial + lembretes de um convidado recém-criado. */
export async function enqueueOnboardingMessages(
  event: Event,
  invitation: Invitation,
  client?: PoolClient
): Promise<void> {
  await enqueueInvitationEmail(event, invitation, {}, client);
  await enqueueRemindersForInvitation(event, invitation, client);
}

/** Convite inicial + lembretes para todos os convidados de um evento. */
export async function enqueueOnboardingForEvent(
  event: Event,
  invitations: Invitation[],
  client?: PoolClient
): Promise<void> {
  for (const invitation of invitations) {
    await enqueueOnboardingMessages(event, invitation, client);
  }
}

/** Reagenda apenas os lembretes de todos os convidados elegíveis. */
export async function rescheduleRemindersForEvent(
  event: Event,
  invitations: Invitation[],
  client?: PoolClient
): Promise<void> {
  for (const invitation of invitations) {
    await enqueueRemindersForInvitation(event, invitation, client);
  }
}

/**
 * Avisa o destinatário anterior de que o convite deixou de existir.
 *
 * A entrega fica sem `invitation_id`: o convite pode ser apagado logo a
 * seguir (ou já ter sido revogado) e o email continua a ser enviado. O
 * nome do convidado não é incluído para não depender do registo.
 */
export async function enqueueInvitationRemoved(
  event: Event,
  recipientEmail: string,
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: event.id,
      invitationId: null,
      messageType: 'invitation_removed',
      reminderKind: null,
      recipientEmail,
      scheduledFor: new Date(),
      idempotencyKey: `invitation_removed:${event.id}:${randomUUID()}`,
    },
    client
  );
}

/** Cancela lembretes e reenvios pendentes de um convite. */
export async function cancelMessagesForInvitation(
  invitationId: string,
  client?: PoolClient
): Promise<number> {
  return emailDeliveryRepository.cancelPendingForInvitation(
    invitationId,
    ['reminder', 'invitation'],
    client
  );
}

/** Cancela lembretes e convites pendentes de um evento. */
export async function cancelMessagesForEvent(
  eventId: string,
  client?: PoolClient
): Promise<number> {
  return emailDeliveryRepository.cancelPendingForEventTypes(
    eventId,
    ['reminder', 'invitation'],
    client
  );
}

/**
 * Notifica o anfitrião de uma recusa.
 *
 * A chave inclui a versão do RSVP: repetir o mesmo pedido não gera
 * uma segunda notificação, mas uma nova recusa após uma alteração de
 * resposta gera.
 */
export async function enqueueDeclineNotification(
  event: Event,
  invitation: Invitation,
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: event.id,
      invitationId: invitation.id,
      messageType: 'decline_notification',
      reminderKind: null,
      recipientEmail: event.hostEmail,
      scheduledFor: new Date(),
      idempotencyKey: `decline_notification:${invitation.id}:${invitation.rsvpVersion}`,
    },
    client
  );
}

/** Comunica o cancelamento do evento aos convidados que não recusaram. */
export async function enqueueEventCancelled(
  event: Event,
  invitations: Invitation[],
  client?: PoolClient
): Promise<void> {
  for (const invitation of invitations) {
    if (invitation.rsvpStatus === 'declined') continue;

    await emailDeliveryRepository.enqueue(
      {
        eventId: event.id,
        invitationId: invitation.id,
        messageType: 'event_cancelled',
        reminderKind: null,
        recipientEmail: invitation.guestEmail,
        scheduledFor: new Date(),
        idempotencyKey: `event_cancelled:${invitation.id}`,
      },
      client
    );
  }
}

/* ─────────────────────────── Mensagens de conta ─────────────────────────── */

/**
 * Enfileira a verificação de email. O token é guardado cifrado na
 * outbox para o worker reconstruir o link; na tabela de tokens fica
 * apenas o HMAC.
 */
export async function enqueueEmailVerification(
  hostId: string,
  email: string,
  token: string,
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: null,
      invitationId: null,
      hostId,
      messageType: 'email_verification',
      reminderKind: null,
      recipientEmail: email,
      scheduledFor: new Date(),
      idempotencyKey: `email_verification:${hostId}:${randomUUID()}`,
      tokenEncrypted: encryptToken(token),
    },
    client
  );
}

/**
 * Enfileira o código OTP que antecede a criação da conta.
 *
 * O código é guardado cifrado na outbox, tal como os tokens: o worker
 * precisa dele para renderizar a mensagem, mas não deve ficar em claro
 * numa tabela.
 */
export async function enqueueRegistrationOtp(
  email: string,
  code: string,
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: null,
      invitationId: null,
      hostId: null,
      messageType: 'registration_otp',
      reminderKind: null,
      recipientEmail: email,
      scheduledFor: new Date(),
      idempotencyKey: `registration_otp:${email}:${randomUUID()}`,
      tokenEncrypted: encryptToken(code),
    },
    client
  );
}

/** Enfileira a mensagem de boas-vindas (uma por conta). */
export async function enqueueHostWelcome(
  hostId: string,
  email: string,
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: null,
      invitationId: null,
      hostId,
      messageType: 'host_welcome',
      reminderKind: null,
      recipientEmail: email,
      scheduledFor: new Date(),
      idempotencyKey: `host_welcome:${hostId}`,
    },
    client
  );
}

/** Enfileira a reposição de senha com token de uso único. */
export async function enqueuePasswordReset(
  hostId: string,
  email: string,
  token: string,
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: null,
      invitationId: null,
      hostId,
      messageType: 'password_reset',
      reminderKind: null,
      recipientEmail: email,
      scheduledFor: new Date(),
      idempotencyKey: `password_reset:${hostId}:${randomUUID()}`,
      tokenEncrypted: encryptToken(token),
    },
    client
  );
}
