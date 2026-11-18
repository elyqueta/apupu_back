import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { logger } from '../config/logger';
import { withTransaction } from '../database/pool';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { activityRepository } from '../repositories/activity.repository';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { eventRepository } from '../repositories/event.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { hostSessionRepository } from '../repositories/hostSession.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { EventRecord } from '../types/event.types';
import { EventManager, HostEventManager } from '../types/eventManager.types';
import { Invitation } from '../types/invitation.types';
import { encryptToken } from '../utils/crypto.util';
import { generateToken, hashToken } from '../utils/token.util';
import {
  ManageEmailStatus,
  generateManageToken,
} from './manageLink.service';
import { enqueueOnboardingMessages } from './reminder.service';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Nome provisório para o convite criado automaticamente a partir do
 * email do gestor. O gestor não tem nome no modelo, por isso usa-se a
 * parte local do email; o anfitrião pode corrigir depois na lista.
 */
function guestNameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim() ?? '';
  const cleaned = local.replace(/[._-]+/g, ' ').trim();

  if (cleaned.length < 2) return email;

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * Enfileira o convite de gestor para envio em segundo plano.
 *
 * O token é guardado cifrado na outbox e nunca é persistido em claro.
 * Uma falha de enfileiramento não desfaz a operação de negócio: o
 * gestor continua criado e o anfitrião pode reenviar.
 */
async function deliverManagerInvite(
  event: EventRecord,
  manager: EventManager,
  token: string,
  idempotencyKey: string
): Promise<ManageEmailStatus> {
  try {
    await emailDeliveryRepository.enqueue({
      eventId: event.id,
      invitationId: null,
      hostId: event.hostId,
      messageType: 'manager_invite',
      reminderKind: null,
      recipientEmail: manager.email,
      scheduledFor: new Date(),
      idempotencyKey,
      tokenEncrypted: encryptToken(token),
    });

    return 'queued';
  } catch (error) {
    logger.error(
      { err: error, eventId: event.id, managerId: manager.id },
      'Falha ao enfileirar o convite de gestor.'
    );
    return 'failed';
  }
}

/**
 * Garante que o gestor também faz parte da lista de convidados.
 *
 * Um gestor pode não ter conta e só receber o link de gestão; ainda
 * assim deve aparecer como convidado do evento. O convite só é criado
 * quando ainda não existe um para o mesmo email, para não duplicar a
 * lista nem disparar emails repetidos. As mensagens seguem a outbox e
 * ficam canceladas enquanto o evento estiver em rascunho.
 */
async function ensureManagerIsGuest(
  event: EventRecord,
  email: string,
  client: PoolClient
): Promise<Invitation | null> {
  const existing = await invitationRepository.findByEventAndEmail(
    event.id,
    email,
    client
  );

  if (existing) return null;

  const token = generateToken();
  const invitation = await invitationRepository.create(
    {
      eventId: event.id,
      guestName: guestNameFromEmail(email),
      guestEmail: email,
      guestPhone: null,
      tableName: null,
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
}

export interface AddManagerResult {
  manager: EventManager;
  status: ManageEmailStatus;
}

export interface ResendManagerResult {
  manager: EventManager;
  status: ManageEmailStatus;
}

/**
 * Gestores de evento.
 *
 * O anfitrião (proprietário) adiciona gestores por email. Um gestor
 * pode não ter conta: recebe um link próprio e usa a área de gestão
 * por link. Quando cria conta com o mesmo email verificado, o evento
 * passa também a aparecer no workspace.
 *
 * Todas as mutações são limitadas ao proprietário: o UUID do evento e
 * o id do gestor nunca são autorização por si só.
 */
export const eventManagerService = {
  /** Gestores activos de todos os eventos do anfitrião. */
  async listAll(hostId: string): Promise<HostEventManager[]> {
    return eventManagerRepository.listActiveByHost(hostId);
  },

  async list(hostId: string, eventId: string): Promise<EventManager[]> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    return eventManagerRepository.listActiveByEvent(eventId);
  },

  async add(hostId: string, eventId: string, emailInput: string): Promise<AddManagerResult> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    const email = normalizeEmail(emailInput);

    if (email === event.hostEmail.trim().toLowerCase()) {
      throw new ValidationError('Verifique os campos indicados.', {
        email: ['O anfitrião não pode ser adicionado como gestor.'],
      });
    }

    const material = generateManageToken();

    let manager: EventManager;

    try {
      manager = await withTransaction(async (client) => {
        const existing = await eventManagerRepository.findByEventAndEmailForUpdate(
          eventId,
          email,
          client
        );

        let saved: EventManager;

        if (existing) {
          if (!existing.revokedAt) {
            throw new ConflictError(
              'Este email já é gestor do evento.',
              'manager_already_exists'
            );
          }

          const reactivated = await eventManagerRepository.reactivate(
            existing.id,
            {
              tokenHash: material.hash,
              tokenExpiresAt: material.expiresAt,
            },
            client
          );

          if (!reactivated) {
            throw new Error('Falha ao reativar gestor do evento.');
          }

          saved = reactivated;
        } else {
          saved = await eventManagerRepository.create(
            {
              eventId,
              email,
              tokenHash: material.hash,
              tokenExpiresAt: material.expiresAt,
            },
            client
          );
        }

        await ensureManagerIsGuest(event, email, client);

        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'Este email já é gestor do evento.',
          'manager_already_exists'
        );
      }
      throw error;
    }

    const status = await deliverManagerInvite(
      event,
      manager,
      material.token,
      `manager_invite:${eventId}:${manager.id}:${randomUUID()}`
    );

    return { manager, status };
  },

  async remove(hostId: string, eventId: string, managerId: string): Promise<EventManager> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    const manager = await eventManagerRepository.findActiveById(managerId);

    if (!manager || manager.eventId !== eventId) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    const removed = await withTransaction(async (client) => {
      const revoked = await eventManagerRepository.revoke(managerId, client);

      if (revoked) {
        await hostSessionRepository.revokeAllForManager(managerId, client);
      }

      return revoked;
    });

    if (!removed) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    return manager;
  },

  async resend(
    hostId: string,
    eventId: string,
    managerId: string
  ): Promise<ResendManagerResult> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    const manager = await eventManagerRepository.findActiveById(managerId);

    if (!manager || manager.eventId !== eventId) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    const material = generateManageToken();
    const updated = await eventManagerRepository.rotateToken(managerId, {
      tokenHash: material.hash,
      tokenExpiresAt: material.expiresAt,
    });

    if (!updated) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    const status = await deliverManagerInvite(
      event,
      updated,
      material.token,
      `manager_invite:${eventId}:${managerId}:resend:${randomUUID()}`
    );

    return { manager: updated, status };
  },
};
