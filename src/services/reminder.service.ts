import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { env } from '../config/env';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { Event } from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import { buildReminderSchedule } from '../utils/date.util';

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
  client?: PoolClient
): Promise<void> {
  if (isSuppressed(invitation)) return;

  const schedule = buildReminderSchedule(
    event.startsAt,
    event.timezone,
    env.REMINDER_OFFSETS_DAYS,
    env.REMINDER_LOCAL_HOUR
  );

  for (const reminder of schedule) {
    await emailDeliveryRepository.enqueue(
      {
        eventId: event.id,
        invitationId: invitation.id,
        messageType: 'reminder',
        reminderKind: reminder.kind,
        recipientEmail: invitation.guestEmail,
        scheduledFor: reminder.scheduledFor,
        idempotencyKey: `reminder:${invitation.id}:${reminder.scheduledFor.toISOString()}`,
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
