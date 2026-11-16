import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { hostSessionRepository } from '../repositories/hostSession.repository';
import { EventRecord } from '../types/event.types';
import { HostSession } from '../types/hostSession.types';
import { csrfTokenFor, generateToken, hashToken } from '../utils/token.util';
import {
  ManageEmailStatus,
  manageLinkService,
} from './manageLink.service';

const INVALID_MANAGE_LINK = 'Link de gestão inválido ou expirado.';

function isManageTokenValid(event: EventRecord): boolean {
  if (event.manageTokenRevokedAt) return false;
  if (event.manageTokenExpiresAt && event.manageTokenExpiresAt.getTime() <= Date.now()) {
    return false;
  }
  return true;
}

export interface CreatedHostSession {
  session: HostSession;
  sessionToken: string;
  csrfToken: string;
  event: EventRecord;
  /** Resultado do envio do novo link emitido pela rotação. */
  manageEmailStatus: ManageEmailStatus;
}

export const hostSessionService = {
  /**
   * Troca o segredo de gestão por uma sessão de curta duração.
   *
   * O segredo nunca é devolvido nem registado. A sessão é um token
   * aleatório independente; a base de dados guarda apenas o seu hash.
   *
   * Ao ser usado, o link roda: é emitido um token novo (enviado por
   * email) e o anterior deixa de corresponder ao hash guardado. A
   * criação da sessão e a rotação são atómicas.
   */
  async create(manageToken: string): Promise<CreatedHostSession> {
    const manageTokenHash = hashToken(manageToken);
    const found = await eventRepository.findByManageTokenHash(manageTokenHash);

    if (!found || !isManageTokenValid(found)) {
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
        current.id,
        hashToken(sessionToken),
        expiresAt,
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
      manageEmailStatus,
    };
  },

  /**
   * Resolve uma sessão activa. Devolve `null` para qualquer situação
   * inválida — expirada, revogada, evento apagado ou segredo de gestão
   * revogado — para que o chamador responda de forma genérica.
   */
  async authenticate(
    sessionToken: string
  ): Promise<{ session: HostSession; event: EventRecord } | null> {
    const session = await hostSessionRepository.findActiveByTokenHash(hashToken(sessionToken));

    if (!session) return null;

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
};
