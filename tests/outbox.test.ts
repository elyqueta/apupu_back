import { describe, expect, it } from 'vitest';
import type { DeliveryContext } from '../src/repositories/emailDelivery.repository';
import { evaluateApplicability } from '../src/services/outbox.service';
import { reminderScheduledFor } from '../src/utils/date.util';

const STARTS_AT = new Date('2027-03-01T18:00:00Z');
const TIMEZONE = 'Africa/Luanda';

function context(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000002',
    invitationId: '00000000-0000-4000-8000-000000000003',
    messageType: 'invitation',
    reminderKind: null,
    recipientEmail: 'convidado@example.test',
    scheduledFor: new Date(),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    providerMessageId: null,
    lastError: null,
    idempotencyKey: 'invitation:test:initial',
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    eventTitle: 'Evento de teste',
    eventStatus: 'scheduled',
    eventStartsAt: STARTS_AT,
    eventEndsAt: null,
    eventTimezone: TIMEZONE,
    eventLocationType: 'venue',
    eventLocationName: 'Salão',
    eventLocationAddress: 'Luanda',
    eventOnlineUrl: null,
    eventDressCode: null,
    eventRsvpDeadline: null,
    eventContributionEnabled: false,
    hostName: 'Anfitriã',
    hostEmail: 'host@example.test',
    guestName: 'Convidado',
    guestEmail: 'convidado@example.test',
    tokenEncrypted: 'cifrado',
    rsvpStatus: 'pending',
    claimRevokedAt: null,
    ...overrides,
  };
}

describe('evaluateApplicability', () => {
  it('aceita o convite inicial de um evento agendado', () => {
    expect(evaluateApplicability(context())).toEqual({ ok: true });
  });

  it('nunca enfileira o link de gestão na outbox', () => {
    expect(evaluateApplicability(context({ messageType: 'manage_link' }))).toEqual({
      ok: false,
      reason: 'manage_link_not_queued',
    });
  });

  it('cancela convites e lembretes de eventos cancelados', () => {
    expect(
      evaluateApplicability(context({ eventStatus: 'cancelled' }))
    ).toEqual({ ok: false, reason: 'event_cancelled' });

    expect(
      evaluateApplicability(context({ eventStatus: 'completed' }))
    ).toEqual({ ok: false, reason: 'event_completed' });
  });

  it('suprime convites e lembretes enquanto o evento é rascunho', () => {
    expect(evaluateApplicability(context({ eventStatus: 'draft' }))).toEqual({
      ok: false,
      reason: 'event_draft',
    });

    expect(
      evaluateApplicability(
        context({
          eventStatus: 'draft',
          messageType: 'reminder',
          reminderKind: '7d',
          scheduledFor: reminderScheduledFor(STARTS_AT, TIMEZONE, 7, 9),
        })
      )
    ).toEqual({ ok: false, reason: 'event_draft' });
  });

  it('mantém a notificação de recusa ao anfitrião num evento em rascunho', () => {
    expect(
      evaluateApplicability(
        context({ eventStatus: 'draft', messageType: 'decline_notification' })
      )
    ).toEqual({ ok: true });
  });

  it('mantém o aviso de cancelamento mesmo com o evento cancelado', () => {
    expect(
      evaluateApplicability(
        context({ messageType: 'event_cancelled', eventStatus: 'cancelled' })
      )
    ).toEqual({ ok: true });
  });

  it('suprime lembretes de um convite recusado', () => {
    expect(
      evaluateApplicability(
        context({
          messageType: 'reminder',
          reminderKind: '7d',
          scheduledFor: reminderScheduledFor(STARTS_AT, TIMEZONE, 7, 9),
          rsvpStatus: 'declined',
        })
      )
    ).toEqual({ ok: false, reason: 'invitation_declined' });
  });

  it('mantém a notificação de recusa mesmo com RSVP declined', () => {
    expect(
      evaluateApplicability(
        context({ messageType: 'decline_notification', rsvpStatus: 'declined' })
      )
    ).toEqual({ ok: true });
  });

  it('suprime mensagens de convites com acesso revogado', () => {
    expect(
      evaluateApplicability(context({ claimRevokedAt: new Date() }))
    ).toEqual({ ok: false, reason: 'claim_revoked' });
  });

  it('rejeita entregas sem convite associado', () => {
    expect(evaluateApplicability(context({ invitationId: null }))).toEqual({
      ok: false,
      reason: 'missing_invitation',
    });
  });

  it('rejeita lembretes com um marco inválido', () => {
    expect(
      evaluateApplicability(context({ messageType: 'reminder', reminderKind: 'amanhã' }))
    ).toEqual({ ok: false, reason: 'invalid_reminder_kind' });
  });

  it('rejeita lembretes obsoletos após alteração de data ou fuso', () => {
    expect(
      evaluateApplicability(
        context({
          messageType: 'reminder',
          reminderKind: '7d',
          // Data antiga: o evento foi reagendado depois de a entrega
          // ter sido criada.
          scheduledFor: new Date('2027-01-01T08:00:00Z'),
        })
      )
    ).toEqual({ ok: false, reason: 'obsolete_reminder' });
  });

  it('aceita o lembrete quando o instante coincide com o cálculo actual', () => {
    const scheduledFor = reminderScheduledFor(STARTS_AT, TIMEZONE, 7, 9);

    expect(
      evaluateApplicability(
        context({ messageType: 'reminder', reminderKind: '7d', scheduledFor })
      )
    ).toEqual({ ok: true });
  });
});
