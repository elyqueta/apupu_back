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
import { teamRepository } from '../repositories/team.repository';
import {
  AddEventManagerBody,
  RegenerateManagerAccessBody,
  UpdateManagerLinkBody,
} from '../schemas/host.schemas';
import { EventRecord } from '../types/event.types';
import { EventManager, HostEventManager } from '../types/eventManager.types';
import { TeamWithStats } from '../types/team.types';
import { Invitation } from '../types/invitation.types';
import {
  generateAccessCode,
  formatAccessCode,
  hashAccessCode,
} from '../utils/accessCode.util';
import { encryptToken } from '../utils/crypto.util';
import { links } from '../utils/links.util';
import { normalizeAngolanPhone } from '../utils/phone.util';
import { generateToken, hashToken } from '../utils/token.util';
import {
  ManageEmailStatus,
  generateManageToken,
} from './manageLink.service';
import { linkValidityService } from './linkValidity.service';
import { enqueueOnboardingMessages } from './reminder.service';

/** Estado do email de convite, incluindo o caso sem email (só telefone). */
export type ManagerInviteStatus = ManageEmailStatus | 'not_sent';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Nome provisório do convite automático criado para um gestor com email. */
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
 * Enfileira o convite de gestor com o link e o código de acesso.
 *
 * O link fica cifrado em `token_encrypted` e o código em `payload`,
 * cifrado em repouso tal como o resto da linha. Uma falha de enfilei-
 * ramento não desfaz a operação: o anfitrião vê o código no modal e
 * pode reenviar.
 */
async function deliverManagerInvite(
  event: EventRecord,
  manager: EventManager,
  token: string,
  code: string | null,
  idempotencyKey: string
): Promise<ManagerInviteStatus> {
  if (!manager.email) return 'not_sent';

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
      payload: code ? { access_code: formatAccessCode(code) } : {},
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

/** Garante que um gestor com email também aparece na lista de convidados. */
async function ensureManagerIsGuest(
  event: EventRecord,
  email: string,
  displayName: string | null,
  client: PoolClient
): Promise<Invitation | null> {
  const existing = await invitationRepository.findByEventAndEmail(event.id, email, client);

  if (existing) return null;

  const token = generateToken();
  const invitation = await invitationRepository.create(
    {
      eventId: event.id,
      guestName: displayName ?? guestNameFromEmail(email),
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
  team: TeamWithStats;
  link: string;
  code: string;
  status: ManagerInviteStatus;
}

export interface ResendManagerResult {
  manager: EventManager;
  link: string;
  code: string;
  status: ManagerInviteStatus;
}

export interface ManagerLinkResult {
  manager: EventManager;
}

function normalizeContact(input: AddEventManagerBody): {
  email: string | null;
  phone: string | null;
} {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const phone = input.phone?.trim() ? normalizeAngolanPhone(input.phone) : null;

  if (!email && !phone) {
    throw new ValidationError('Verifique os campos indicados.', {
      email: ['Indique um email ou telefone.'],
      phone: ['Indique um email ou telefone.'],
    });
  }

  if (input.phone?.trim() && !phone) {
    throw new ValidationError('Verifique os campos indicados.', {
      phone: ['Telefone inválido. Use o formato angolano.'],
    });
  }

  return { email, phone };
}

/**
 * Gestores de evento. Criar um gestor cria sempre a equipa dele na
 * mesma transacção: não existe gestor sem equipa por nenhuma rota.
 */
export const eventManagerService = {
  /**
   * Promove um membro de equipa a gestor. A equipa já existe, mas a
   * regra de um gestor ativo por equipa continua a aplicar-se.
   */
  async ensureForMember(
    hostId: string,
    eventId: string,
    teamId: string,
    contact: { email: string | null; phone: string | null; displayName: string | null },
    client: PoolClient
  ): Promise<{ manager: EventManager; code: string; link: string }> {
    const active = await eventManagerRepository.findActiveByTeam(teamId, client);

    if (active) {
      throw new ConflictError('A equipa já tem um gestor.', 'team_already_has_manager');
    }

    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

    const material = generateManageToken();
    const code = generateAccessCode();
    const linkExpiresAt = await linkValidityService.resolve(event, null);

    const manager = await eventManagerRepository.create(
      {
        eventId,
        teamId,
        email: contact.email,
        phone: contact.phone,
        displayName: contact.displayName,
        tokenHash: material.hash,
        tokenExpiresAt: linkExpiresAt,
        accessCodeHash: hashAccessCode(code, randomUUID()),
        linkExpiresAt,
      },
      client
    );

    await eventManagerRepository.updateAccessCodeHash(
      manager.id,
      hashAccessCode(code, manager.id),
      client
    );

    if (contact.email) {
      await deliverManagerInvite(
        event,
        manager,
        material.token,
        code,
        `manager_invite:${eventId}:${manager.id}:promote:${randomUUID()}`
      );
    }

    return { manager, code, link: links.manageEvent(material.token) };
  },

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

  async add(
    hostId: string,
    eventId: string,
    input: AddEventManagerBody
  ): Promise<AddManagerResult> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'event_not_found');
    }

    const { email, phone } = normalizeContact(input);
    const displayName = input.display_name?.trim() || null;

    if (email && email === event.hostEmail.trim().toLowerCase()) {
      throw new ValidationError('Verifique os campos indicados.', {
        email: ['O anfitrião não pode ser adicionado como gestor.'],
      });
    }

    const material = generateManageToken();
    const code = generateAccessCode();
    const accessCodeHash = hashAccessCode(code, randomUUID());
    const linkExpiresAt = await linkValidityService.resolve(event, input.link_expires_at);

    let manager: EventManager;
    let team: TeamWithStats;

    try {
      const result = await withTransaction(async (client) => {
        const existing = email
          ? await eventManagerRepository.findByEventAndEmailForUpdate(eventId, email, client)
          : null;

        if (existing && !existing.revokedAt) {
          throw new ConflictError(
            'Este email já é gestor do evento.',
            'manager_already_exists'
          );
        }

        const savedTeam = await teamRepository.create(
          {
            eventId,
            name: input.team_name.trim(),
            category: input.team_category ?? 'outra',
            description: input.team_description?.trim() || null,
            createdByHostId: event.hostId,
          },
          client
        );

        let savedManager: EventManager;

        if (existing) {
          const reactivated = await eventManagerRepository.reactivate(
            existing.id,
            {
              teamId: savedTeam.id,
              email,
              phone,
              displayName,
              tokenHash: material.hash,
              tokenExpiresAt: linkExpiresAt,
              accessCodeHash: hashAccessCode(code, existing.id),
              linkExpiresAt,
            },
            client
          );

          if (!reactivated) throw new Error('Falha ao reativar gestor do evento.');
          savedManager = reactivated;
        } else {
          // O hash do código depende do id; criamos primeiro com um hash
          // temporário e corrigimos logo a seguir na mesma transacção.
          savedManager = await eventManagerRepository.create(
            {
              eventId,
              teamId: savedTeam.id,
              email,
              phone,
              displayName,
              tokenHash: material.hash,
              tokenExpiresAt: linkExpiresAt,
              accessCodeHash,
              linkExpiresAt,
            },
            client
          );

          await eventManagerRepository.updateAccessCodeHash(
            savedManager.id,
            hashAccessCode(code, savedManager.id),
            client
          );
        }

        if (email) {
          await ensureManagerIsGuest(event, email, displayName, client);
        }

        return { manager: savedManager, team: savedTeam };
      });

      manager = result.manager;
      team = result.team;
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
      code,
      `manager_invite:${eventId}:${manager.id}:${randomUUID()}`
    );

    return { manager, team, link: links.manageEvent(material.token), code, status };
  },

  async updateLink(
    hostId: string,
    eventId: string,
    managerId: string,
    input: UpdateManagerLinkBody
  ): Promise<ManagerLinkResult> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

    const expiresAt = await linkValidityService.resolve(event, input.link_expires_at);
    const updated = await eventManagerRepository.updateLinkValidity(managerId, expiresAt);

    if (!updated || updated.eventId !== eventId) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    return { manager: updated };
  },

  /**
   * Gera um código novo e roda o link. O código anterior deixa de ser
   * aceite porque o token antigo também é invalidado.
   */
  async regenerateAccess(
    hostId: string,
    eventId: string,
    managerId: string,
    _input: RegenerateManagerAccessBody = {}
  ): Promise<ResendManagerResult> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

    const manager = await eventManagerRepository.findActiveById(managerId);

    if (!manager || manager.eventId !== eventId) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    const material = generateManageToken();
    const code = generateAccessCode();
    const linkExpiresAt = await linkValidityService.resolve(event, null);

    const updated = await eventManagerRepository.rotateToken(managerId, {
      tokenHash: material.hash,
      tokenExpiresAt: linkExpiresAt,
      accessCodeHash: hashAccessCode(code, managerId),
      linkExpiresAt,
      resetFailures: true,
    });

    if (!updated) throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');

    const status = await deliverManagerInvite(
      event,
      updated,
      material.token,
      code,
      `manager_invite:${eventId}:${managerId}:regenerate:${randomUUID()}`
    );

    return { manager: updated, link: links.manageEvent(material.token), code, status };
  },

  async revokeLink(
    hostId: string,
    eventId: string,
    managerId: string
  ): Promise<ManagerLinkResult> {
    const event = await eventRepository.findByIdForHost(eventId, hostId);

    if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

    const manager = await eventManagerRepository.findActiveById(managerId);

    if (!manager || manager.eventId !== eventId) {
      throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');
    }

    const revoked = await withTransaction(async (client) => {
      const changed = await eventManagerRepository.revokeLink(managerId, client);
      if (changed) await hostSessionRepository.revokeAllForManager(managerId, client);
      return changed;
    });

    if (!revoked) throw new NotFoundError('Gestor não encontrado.', 'manager_not_found');

    return { manager: await eventManagerRepository.findById(managerId) ?? manager };
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
      if (revoked) await hostSessionRepository.revokeAllForManager(managerId, client);
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
    return this.regenerateAccess(hostId, eventId, managerId);
  },
};
