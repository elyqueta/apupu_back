import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { ConflictError, NotFoundError } from '../errors';
import { activityRepository } from '../repositories/activity.repository';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { CreateInvitationBody, UpdateInvitationBody } from '../schemas/event.schemas';
import { Event } from '../types/event.types';
import { GuestAccess } from '../types/guestAccess.types';
import { Invitation, UpdateInvitationInput } from '../types/invitation.types';
import { decryptToken, encryptToken } from '../utils/crypto.util';
import { isUniqueViolation } from '../utils/db.util';
import { generateToken, hashesMatch, hashToken } from '../utils/token.util';
import { accountOwnsInvitation, AccountIdentity } from './guestAccess.service';
import { linkValidityService } from './linkValidity.service';
import {
  cancelMessagesForInvitation,
  enqueueDeclineNotification,
  enqueueInvitationEmail,
  enqueueInvitationRemoved,
  enqueueOnboardingMessages,
  enqueueRemindersForInvitation,
} from './reminder.service';

/**
 * Resposta única para token inválido, convite reclamado por outro
 * navegador ou convite inexistente. Um atacante não deve conseguir
 * distinguir "não existe" de "existe mas não é teu".
 */
const INVITATION_NOT_FOUND = 'Convite não encontrado.';

/**
 * O anfitrião não pode ser convidado do próprio evento: o email dele
 * identifica a conta que gere o evento e receberia um link de convidado
 * ambíguo. A regra aplica-se a criar e a alterar convites.
 */
function assertGuestEmailIsNotHost(event: Event, email: string): void {
  if (email.trim().toLowerCase() !== event.hostEmail.trim().toLowerCase()) return;

  throw new ConflictError(
    'O email do anfitrião não pode ser adicionado como convidado.',
    'invitation_host_email',
    { email: ['O email do anfitrião não pode ser adicionado como convidado.'] }
  );
}

export function isRsvpDeadlinePassed(event: Event): boolean {
  return event.rsvpDeadline !== null && event.rsvpDeadline.getTime() <= Date.now();
}

/**
 * Link expirado produz exactamente o mesmo 404 de um link inválido:
 * o convidado nunca deve conseguir distinguir o motivo.
 */
export function isInvitationLinkExpired(invitation: Invitation): boolean {
  return invitation.linkExpiresAt !== null && invitation.linkExpiresAt.getTime() <= Date.now();
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
  /** Como o convite foi autorizado (capacidade ou conta). */
  access: GuestAccess;
  rsvpDeadlinePassed: boolean;
  /** Capacidade nova a gravar no cookie; `null` quando não há. */
  newCapability: string | null;
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

    assertGuestEmailIsNotHost(event, input.email);

    const total = await invitationRepository.countByEvent(event.id);

    if (total >= env.MAX_INVITATIONS_PER_EVENT) {
      throw new ConflictError(
        'O limite de convidados deste evento foi atingido.',
        'invitation_limit_reached'
      );
    }

    const token = generateToken();
    const linkExpiresAt = await linkValidityService.maximumFor(event);

    try {
      return await withTransaction(async (client) => {
        const invitation = await invitationRepository.create(
          {
            eventId: event.id,
            guestName: input.name,
            guestEmail: input.email,
            guestPhone: input.phone ?? null,
            tableName: input.table_name ?? null,
            linkExpiresAt,
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
        const emailChanged =
          input.email !== undefined && input.email !== current.guestEmail;
        let event: Event | null = null;

        if (input.email !== undefined) {
          event = await eventRepository.findById(eventId, client);

          if (!event) {
            throw new NotFoundError('Evento não encontrado.', 'event_not_found');
          }

          assertGuestEmailIsNotHost(event, input.email);
        }

        // Depois de o convidado abrir o link, email e telefone ficam
        // bloqueados: o link está associado ao destinatário original.
        const changesContact =
          emailChanged ||
          (input.phone !== undefined && input.phone !== current.guestPhone);

        if (changesContact && (current.claimedAt || current.claimHash)) {
          throw new ConflictError(
            'O convidado já abriu o convite; o email e o telefone não podem ser alterados.',
            'invitation_already_opened'
          );
        }

        const changes: UpdateInvitationInput = {};

        if (input.name !== undefined) changes.guestName = input.name;
        if (input.email !== undefined) changes.guestEmail = input.email;
        if (input.phone !== undefined) changes.guestPhone = input.phone;
        if (input.table_name !== undefined) changes.tableName = input.table_name;

        if (emailChanged) {
          // O link é pessoal: ao corrigir o email, o link anterior deixa
          // de corresponder a este convite e o destinatário antigo é
          // avisado de que foi removido.
          const token = generateToken();
          changes.tokenHash = hashToken(token);
          changes.tokenEncrypted = encryptToken(token);
          changes.resetClaim = true;
        }

        const updated = await invitationRepository.update(current.id, changes, client);

        if (!updated) {
          throw new NotFoundError('Convidado não encontrado.', 'invitation_not_found');
        }

        if (emailChanged && event) {
          await cancelMessagesForInvitation(current.id, client);
          await enqueueInvitationRemoved(event, current.guestEmail, client);
          await enqueueInvitationEmail(event, updated, { resend: true }, client);
          await enqueueRemindersForInvitation(event, updated, client, {
            keySuffix: randomUUID(),
          });
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

  /**
   * Altera a validade do link individual do convite.
   *
   * O limite é fim do evento + 30 dias; o link do gestor continua com
   * a regra antiga (1 semana / máx. fim + 1 dia).
   */
  async updateLink(
    eventId: string,
    invitationId: string,
    expiresAt: Date
  ): Promise<Invitation> {
    return withTransaction(async (client) => {
      const invitation = await findOwnedInvitation(eventId, invitationId, client);
      const event = await eventRepository.findById(eventId, client);
      if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

      const resolved = await linkValidityService.resolveInvitationExpiry(event, expiresAt);
      const updated = await invitationRepository.update(
        invitation.id,
        { linkExpiresAt: resolved },
        client
      );
      if (!updated) {
        throw new NotFoundError('Convidado não encontrado.', 'invitation_not_found');
      }
      return updated;
    });
  },

  async remove(eventId: string, invitationId: string): Promise<void> {
    await withTransaction(async (client) => {
      const invitation = await findOwnedInvitation(eventId, invitationId, client);
      const event = await eventRepository.findById(eventId, client);

      if (event) {
        await enqueueInvitationRemoved(event, invitation.guestEmail, client);
      }

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

      const event = await eventRepository.findById(eventId, client);

      if (event) {
        await enqueueInvitationRemoved(event, invitation.guestEmail, client);
      }

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
   *
   * Uma conta com o email verificado do convidado também pode abrir o
   * convite, mesmo que ele já tenha sido reclamado noutro navegador.
   * Nesse caso o `claim_hash` existente não é alterado.
   */
  async claim(
    token: string,
    capability: string | null,
    account: AccountIdentity | null
  ): Promise<PublicInvitationResult> {
    const invitation = await invitationRepository.findByTokenHash(hashToken(token));

    if (!invitation || invitation.claimRevokedAt || isInvitationLinkExpired(invitation)) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    const event = await eventRepository.findById(invitation.eventId);

    if (!event) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    if (invitation.claimHash) {
      if (capability && hashesMatch(hashToken(capability), invitation.claimHash)) {
        return {
          event,
          invitation,
          access: { kind: 'capability', secret: capability },
          rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
          newCapability: null,
        };
      }

      if (accountOwnsInvitation(invitation, account)) {
        return {
          event,
          invitation,
          access: {
            kind: 'account',
            secret: account.sessionToken,
            email: account.email,
          },
          rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
          newCapability: null,
        };
      }

      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    const candidate = capability ?? generateToken();
    const claimed = await invitationRepository.claim(invitation.id, hashToken(candidate));

    if (claimed) {
      return {
        event,
        invitation: claimed,
        access: { kind: 'capability', secret: candidate },
        rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
        newCapability: capability === null ? candidate : null,
      };
    }

    // Outro navegador reclamou entre a leitura e o UPDATE.
    const refreshed = await invitationRepository.findById(invitation.id);

    if (refreshed && isInvitationLinkExpired(refreshed)) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    if (
      refreshed?.claimHash &&
      capability &&
      hashesMatch(hashToken(capability), refreshed.claimHash)
    ) {
      return {
        event,
        invitation: refreshed,
        access: { kind: 'capability', secret: capability },
        rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
        newCapability: null,
      };
    }

    if (refreshed && accountOwnsInvitation(refreshed, account)) {
      return {
        event,
        invitation: refreshed,
        access: {
          kind: 'account',
          secret: account.sessionToken,
          email: account.email,
        },
        rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
        newCapability: null,
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
    access: GuestAccess,
    status: 'accepted' | 'declined',
    message?: string | null
  ): Promise<PublicInvitationResult> {
    return withTransaction(async (client) => {
      const current = await invitationRepository.findByIdForUpdate(invitationId, client);

      if (
        !current ||
        current.eventId !== eventId ||
        current.claimRevokedAt ||
        isInvitationLinkExpired(current) ||
        !invitationMatchesAccess(current, access)
      ) {
        throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
      }

      const event = await eventRepository.findByIdForUpdate(eventId, client);

      if (!event) {
        throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
      }

      if (event.status === 'cancelled') {
        throw new ConflictError(
          'Este evento foi cancelado. Já não é possível fazer alterações.',
          'event_cancelled'
        );
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

      // `undefined` significa "não enviado": mantém a mensagem anterior.
      // `null` significa "campo vazio": limpa a mensagem anterior.
      const nextMessage = message === undefined ? current.guestMessage : message;

      if (current.rsvpStatus === status) {
        const invitation =
          nextMessage === current.guestMessage
            ? current
            : await invitationRepository.setGuestMessage(current.id, nextMessage, client);

        if (!invitation) {
          throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
        }

        return {
          event,
          invitation,
          access,
          rsvpDeadlinePassed: false,
          newCapability: null,
        };
      }

      const updated = await invitationRepository.respond(
        current.id,
        status,
        nextMessage,
        client
      );

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
          metadata: updated.guestMessage
            ? { guest_message: updated.guestMessage }
            : undefined,
        },
        client
      );

      return {
        event,
        invitation: updated,
        access,
        rsvpDeadlinePassed: false,
        newCapability: null,
      };
    });
  },
};

/** Valida a forma de acesso contra o convite actual. */
function invitationMatchesAccess(
  invitation: Invitation,
  access: GuestAccess
): boolean {
  if (access.kind === 'account') {
    return (
      invitation.guestEmail.trim().toLowerCase() === access.email.trim().toLowerCase()
    );
  }

  return Boolean(
    invitation.claimHash &&
      hashesMatch(hashToken(access.secret), invitation.claimHash)
  );
}
