import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { NotFoundError } from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { eventRepository } from '../repositories/event.repository';
import { hostSessionRepository } from '../repositories/hostSession.repository';
import { EventAccessRole, EventRecord } from '../types/event.types';
import { HostSession } from '../types/hostSession.types';
import { csrfTokenFor, generateToken, hashToken } from '../utils/token.util';
import { ManageEmailStatus, manageLinkService } from './manageLink.service';

const INVALID_MANAGE_LINK = 'Link de gestão inválido ou expirado.';

function isManageTokenValid(event: EventRecord): boolean {
  if (event.manageTokenRevokedAt) return false;
  if (event.manageTokenExpiresAt && event.manageTokenExpiresAt.getTime() <= Date.now()) {
    return false;
  }
  return true;
}

function isManagerTokenValid(manager: {
  revokedAt: Date | null;
  tokenExpiresAt: Date | null;
}): boolean {
  if (manager.revokedAt) return false;
  if (manager.tokenExpiresAt && manager.tokenExpiresAt.getTime() <= Date.now()) {
    return false;
  }
  return true;
}

export interface CreatedHostSession {
  session: HostSession;
  sessionToken: string;
  csrfToken: string;
  event: EventRecord;
  role: EventAccessRole;
  /**
   * Resultado do envio do novo link emitido pela rotação. `null` para
   * sessões de gestor: o link do gestor não roda ao ser usado.
   */
  manageEmailStatus: ManageEmailStatus | null;
}

export const hostSessionService = {
  /**
   * Troca o segredo de gestão por uma sessão de curta duração.
   *
   * Dois tipos de segredo são aceites:
   * - link do anfitrião (`events.manage_token_hash`), que roda ao ser
   *   usado: é emitido um token novo e enviado por email;
   * - link de um gestor (`event_managers.token_hash`), que não roda e
   *   apenas abre a área de gestão do evento.
   *
   * O segredo nunca é devolvido nem registado. A sessão é um token
   * aleatório independente; a base de dados guarda apenas o seu hash.
   */
  async create(manageToken: string): Promise<CreatedHostSession> {
    const manageTokenHash = hashToken(manageToken);
    const foundEvent = await eventRepository.findByManageTokenHash(manageTokenHash);

    if (foundEvent) {
      return this.createHostSession(foundEvent, manageTokenHash);
    }

    const manager = await eventManagerRepository.findByTokenHash(manageTokenHash);

    if (!manager || !isManagerTokenValid(manager)) {
      throw new NotFoundError(INVALID_MANAGE_LINK, 'manage_link_invalid');
    }

    const event = await eventRepository.findById(manager.eventId);

    if (!event) {
      throw new NotFoundError(INVALID_MANAGE_LINK, 'manage_link_invalid');
    }

    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + env.HOST_SESSION_TTL_MINUTES * 60 * 1000);

    const session = await hostSessionRepository.create({
      eventId: event.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      role: 'manager',
      managerId: manager.id,
    });

    await eventManagerRepository.touch(manager.id);

    return {
      session,
      sessionToken,
      csrfToken: csrfTokenFor(sessionToken),
      event,
      role: 'manager',
      manageEmailStatus: null,
    };
  },

  /** Fluxo do link do anfitrião: cria a sessão e roda o token. */
  async createHostSession(
    found: EventRecord,
    manageTokenHash: string
  ): Promise<CreatedHostSession> {
    if (!isManageTokenValid(found)) {
      throw new NotFoundError(INVALID_MANAGE_LINK, 'manage_link_invalid');
    }

    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + env.HOST_SESSION_TTL_MINUTES * 60 * 1000);
    const nextManageToken = manageLinkService.generate();

    const rotated = await withTransaction(async (client) => {
      // Relê com lock: o mesmo link pode ser usado em dois pedidos
      // concorrentes. Só o primeiro deve conseguir trocá-lo.
      const current = await eventRepository.findByIdForUpdate(found.id, client);

      if (
        !current ||
        current.manageTokenHash !== manageTokenHash ||
        !isManageTokenValid(current)
      ) {
        throw new NotFoundError(INVALID_MANAGE_LINK, 'manage_link_invalid');
      }

      const session = await hostSessionRepository.create(
        {
          eventId: current.id,
          tokenHash: hashToken(sessionToken),
          expiresAt,
          role: 'host',
        },
        client
      );

      const event = await eventRepository.rotateManageToken(
        current.id,
        {
          hash: nextManageToken.hash,
          expiresAt: nextManageToken.expiresAt,
        },
        client
      );

      if (!event) {
        throw new NotFoundError(INVALID_MANAGE_LINK, 'manage_link_invalid');
      }

      return { session, event };
    });

    const manageEmailStatus = await manageLinkService.deliver(
      rotated.event,
      nextManageToken.token,
      `manage_link:${rotated.event.id}:rotate:${randomUUID()}`
    );

    return {
      session: rotated.session,
      sessionToken,
      csrfToken: csrfTokenFor(sessionToken),
      event: rotated.event,
      role: 'host',
      manageEmailStatus,
    };
  },

  /**
   * Resolve uma sessão activa. Devolve `null` para qualquer situação
   * inválida — expirada, revogada, evento apagado, segredo de gestão
   * revogado ou gestor removido — para que o chamador responda de
   * forma genérica.
   */
  async authenticate(
    sessionToken: string
  ): Promise<{ session: HostSession; event: EventRecord } | null> {
    const session = await hostSessionRepository.findActiveByTokenHash(hashToken(sessionToken));

    if (!session) return null;

    if (session.role === 'manager') {
      if (!session.managerId) return null;

      const manager = await eventManagerRepository.findActiveById(session.managerId);

      if (!manager) return null;

      const event = await eventRepository.findById(session.eventId);

      if (!event) return null;

      await hostSessionRepository.touch(session.id);
      await eventManagerRepository.touch(manager.id);

      return { session, event };
    }

    const event = await eventRepository.findById(session.eventId);

    if (!event || !isManageTokenValid(event)) return null;

    await hostSessionRepository.touch(session.id);

    return { session, event };
  },

  async revoke(sessionId: string): Promise<void> {
    await hostSessionRepository.revoke(sessionId);
  },

  async revokeAllForEvent(eventId: string): Promise<number> {
    return hostSessionRepository.revokeAllForEvent(eventId);
  },

  async revokeAllForManager(managerId: string): Promise<number> {
    return hostSessionRepository.revokeAllForManager(managerId);
  },
};
