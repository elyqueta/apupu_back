import { env } from '../config/env';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { hostSessionRepository } from '../repositories/hostSession.repository';
import { EventRecord } from '../types/event.types';
import { HostSession } from '../types/hostSession.types';
import { csrfTokenFor, generateToken, hashToken } from '../utils/token.util';

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
}

export const hostSessionService = {
  /**
   * Troca o segredo de gestão por uma sessão de curta duração.
   *
   * O segredo nunca é devolvido nem registado. A sessão é um token
   * aleatório independente; a base de dados guarda apenas o seu hash.
   */
  async create(manageToken: string): Promise<CreatedHostSession> {
    const event = await eventRepository.findByManageTokenHash(hashToken(manageToken));

    if (!event || !isManageTokenValid(event)) {
      throw new NotFoundError(INVALID_MANAGE_LINK, 'manage_link_invalid');
    }

    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + env.HOST_SESSION_TTL_MINUTES * 60 * 1000);

    const session = await hostSessionRepository.create(
      event.id,
      hashToken(sessionToken),
      expiresAt
    );

    return {
      session,
      sessionToken,
      csrfToken: csrfTokenFor(sessionToken),
      event,
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
