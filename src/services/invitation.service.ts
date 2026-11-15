import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { ConflictError, NotFoundError } from '../errors';
import { activityRepository } from '../repositories/activity.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { CreateInvitationBody, UpdateInvitationBody } from '../schemas/event.schemas';
import { Event } from '../types/event.types';
import { Invitation, UpdateInvitationInput } from '../types/invitation.types';
import { decryptToken, encryptToken } from '../utils/crypto.util';
import { isUniqueViolation } from '../utils/db.util';
import { csrfTokenFor, generateToken, hashesMatch, hashToken } from '../utils/token.util';
import {
  cancelMessagesForInvitation,
  enqueueDeclineNotification,
  enqueueInvitationEmail,
  enqueueOnboardingMessages,
  enqueueRemindersForInvitation,
} from './reminder.service';

/**
 * Resposta única para token inválido, convite reclamado por outro
 * navegador ou convite inexistente. Um atacante não deve conseguir
 * distinguir "não existe" de "existe mas não é teu".
 */
const INVITATION_NOT_FOUND = 'Convite não encontrado.';

export function isRsvpDeadlinePassed(event: Event): boolean {
  return event.rsvpDeadline !== null && event.rsvpDeadline.getTime() <= Date.now();
}

async function findOwnedInvitation(
  eventId: string,
  invitationId: string,
  client?: Parameters<typeof invitationRepository.findById>[1]
): Promise<Invitation> {
  const invitation = await invitationRepository.findById(invitationId, client);

  if (!invitation || invitation.eventId !== eventId) {
    throw new NotFoundError('Convidado não encontrado.', 'invitation_not_found');
  }

  return invitation;
}

export interface PublicInvitationResult {
  event: Event;
  invitation: Invitation;
  /** Capacidade do navegador (nunca serializada na resposta). */
  capability: string;
  csrfToken: string;
  rsvpDeadlinePassed: boolean;
  /** Verdadeiro quando o cookie de capacidade acabou de ser criado. */
  newCapability: boolean;
}

export const invitationService = {
  /* ───────────────────────── Gestão (anfitrião) ───────────────────────── */

  async list(eventId: string): Promise<Invitation[]> {
    return invitationRepository.listByEvent(eventId);
  },

  async add(event: Event, input: CreateInvitationBody): Promise<Invitation> {
    if (event.status !== 'scheduled') {
      throw new ConflictError(
        'Só é possível adicionar convidados a um evento agendado.',
        'event_not_scheduled'
      );
    }

    const total = await invitationRepository.countByEvent(event.id);

    if (total >= env.MAX_INVITATIONS_PER_EVENT) {
      throw new ConflictError(
        'O limite de convidados deste evento foi atingido.',
        'invitation_limit_reached'
      );
    }

    const token = generateToken();

    try {
      return await withTransaction(async (client) => {
        const invitation = await invitationRepository.create(
          {
            eventId: event.id,
            guestName: input.name,
            guestEmail: input.email,
            guestPhone: input.phone ?? null,
            tableName: input.table_name ?? null,
            tokenHash: hashToken(token),
            tokenEncrypted: encryptToken(token),
          },
          client
        );

        await enqueueOnboardingMessages(event, invitation, client);

        await activityRepository.create(
          {
            eventId: event.id,
            invitationId: invitation.id,
            kind: 'guest_added',
            guestName: invitation.guestName,
          },
          client
        );

        return invitation;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Já existe um convite para este email.', 'invitation_email_duplicate', {
          email: ['Já existe um convite para este email.'],
        });
      }

      throw error;
    }
  },

  async update(
    eventId: string,
    invitationId: string,
    input: UpdateInvitationBody
  ): Promise<Invitation> {
    try {
      return await withTransaction(async (client) => {
        const current = await findOwnedInvitation(eventId, invitationId, client);

        const changes: UpdateInvitationInput = {};
        if (input.name !== undefined) changes.guestName = input.name;
        if (input.email !== undefined) changes.guestEmail = input.email;
        if (input.phone !== undefined) changes.guestPhone = input.phone;
        if (input.table_name !== undefined) changes.tableName = input.table_name;

        const updated = await invitationRepository.update(current.id, changes, client);

        if (!updated) {
          throw new NotFoundError('Convidado não encontrado.', 'invitation_not_found');
        }

        if (input.email !== undefined && input.email !== current.guestEmail) {
          await emailDeliveryRepository.updatePendingRecipient(current.id, input.email, client);
        }

        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Já existe um convite para este email.', 'invitation_email_duplicate', {
          email: ['Já existe um convite para este email.'],
        });
      }

      throw error;
    }
  },

  async remove(eventId: string, invitationId: string): Promise<void> {
    await withTransaction(async (client) => {
      const invitation = await findOwnedInvitation(eventId, invitationId, client);
      await invitationRepository.delete(invitation.id, client);
    });
  },

  async resend(eventId: string, invitationId: string): Promise<'queued'> {
    return withTransaction(async (client) => {
      const invitation = await findOwnedInvitation(eventId, invitationId, client);
      const event = await eventRepository.findById(eventId, client);

      if (!event) {
        throw new NotFoundError('Evento não encontrado.', 'event_not_found');
      }

      if (invitation.claimRevokedAt) {
        throw new ConflictError('Este convite foi revogado.', 'invitation_revoked');
      }

      if (!invitation.tokenEncrypted) {
        throw new ConflictError('O convite não tem um link reutilizável.', 'invitation_not_resendable');
      }

      // Valida que a chave de cifra ainda consegue reconstruir o link.
      decryptToken(invitation.tokenEncrypted);

      await enqueueInvitationEmail(event, invitation, { resend: true }, client);
      await invitationRepository.setSendStatus(invitation.id, 'queued', {}, client);

      return 'queued' as const;
    });
  },

  async revoke(eventId: string, invitationId: string): Promise<Invitation> {
    return withTransaction(async (client) => {
      const invitation = await findOwnedInvitation(eventId, invitationId, client);

      await invitationRepository.revokeClaim(invitation.id, client);
      await cancelMessagesForInvitation(invitation.id, client);

      const updated = await invitationRepository.findById(invitation.id, client);

      if (!updated) {
        throw new NotFoundError('Convidado não encontrado.', 'invitation_not_found');
      }

      return updated;
    });
  },

  /* ───────────────────────── Público (convidado) ──────────────────────── */

  /**
   * Primeiro claim atómico.
   *
   * A capacidade é reutilizada se o navegador já tiver uma: assim o
   * mesmo navegador pode reclamar vários convites sem perder acesso ao
   * anterior. O cookie nunca é revelado na resposta.
   */
  async claim(token: string, capability: string | null): Promise<PublicInvitationResult> {
    const invitation = await invitationRepository.findByTokenHash(hashToken(token));

    if (!invitation || invitation.claimRevokedAt) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    const event = await eventRepository.findById(invitation.eventId);

    if (!event) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    if (invitation.claimHash) {
      if (!capability || !hashesMatch(hashToken(capability), invitation.claimHash)) {
        throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
      }

      return {
        event,
        invitation,
        capability,
        csrfToken: capabilityCsrf(capability),
        rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
        newCapability: false,
      };
    }

    const candidate = capability ?? generateToken();
    const claimed = await invitationRepository.claim(invitation.id, hashToken(candidate));

    if (claimed) {
      return {
        event,
        invitation: claimed,
        capability: candidate,
        csrfToken: capabilityCsrf(candidate),
        rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
        newCapability: capability === null,
      };
    }

    // Outro navegador reclamou entre a leitura e o UPDATE.
    const refreshed = await invitationRepository.findById(invitation.id);

    if (
      refreshed?.claimHash &&
      capability &&
      hashesMatch(hashToken(capability), refreshed.claimHash)
    ) {
      return {
        event,
        invitation: refreshed,
        capability,
        csrfToken: capabilityCsrf(capability),
        rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
        newCapability: false,
      };
    }

    throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
  },

  /**
   * Regista o RSVP de forma atómica.
   *
   * Repetir o mesmo estado não incrementa a versão nem duplica a
   * notificação de recusa. Uma recusa cancela os lembretes na mesma
   * transacção lógica; voltar atrás repõe os marcos futuros.
   */
  async respond(
    eventId: string,
    invitationId: string,
    capability: string,
    status: 'accepted' | 'declined'
  ): Promise<PublicInvitationResult> {
    return withTransaction(async (client) => {
      const current = await invitationRepository.findByIdForUpdate(invitationId, client);

      if (
        !current ||
        current.eventId !== eventId ||
        current.claimRevokedAt ||
        !current.claimHash ||
        !hashesMatch(hashToken(capability), current.claimHash)
      ) {
        throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
      }

      const event = await eventRepository.findByIdForUpdate(eventId, client);

      if (!event) {
        throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
      }

      if (event.status === 'cancelled') {
        throw new ConflictError('Este evento foi cancelado.', 'event_cancelled');
      }

      if (event.status === 'completed') {
        throw new ConflictError('Este evento já terminou.', 'event_completed');
      }

      if (isRsvpDeadlinePassed(event)) {
        throw new ConflictError(
          'O prazo de resposta deste convite já terminou.',
          'rsvp_deadline_passed'
        );
      }

      if (current.rsvpStatus === status) {
        return {
          event,
          invitation: current,
          capability,
          csrfToken: capabilityCsrf(capability),
          rsvpDeadlinePassed: false,
          newCapability: false,
        };
      }

      const updated = await invitationRepository.respond(current.id, status, client);

      if (!updated) {
        throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
      }

      if (status === 'declined') {
        await cancelMessagesForInvitation(updated.id, client);
        await enqueueDeclineNotification(event, updated, client);
      } else if (current.rsvpStatus === 'declined') {
        await enqueueRemindersForInvitation(event, updated, client);
      }

      await activityRepository.create(
        {
          eventId: event.id,
          invitationId: updated.id,
          kind: status === 'accepted' ? 'rsvp_accepted' : 'rsvp_declined',
          guestName: updated.guestName,
        },
        client
      );

      return {
        event,
        invitation: updated,
        capability,
        csrfToken: capabilityCsrf(capability),
        rsvpDeadlinePassed: false,
        newCapability: false,
      };
    });
  },
};

function capabilityCsrf(capability: string): string {
  return csrfTokenFor(capability);
}
