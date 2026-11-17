import { NextFunction, Request, Response } from 'express';
import { NotFoundError, UnauthorizedError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { hostAuthSessionRepository } from '../repositories/hostAuthSession.repository';
import { hostRepository } from '../repositories/host.repository';
import { hostSessionService } from '../services/hostSession.service';
import {
  clearAuthSession,
  clearHostSession,
  readAuthSession,
  readHostSession,
} from '../utils/cookie.util';
import { hashToken } from '../utils/token.util';

/**
 * Autoriza operações de gestão de um evento.
 *
 * Dois caminhos coexistem durante a migração:
 * 1. sessão legada por evento (`apupu_host_<eventId>`), obtida ao
 *    trocar o segredo do link de gestão (do anfitrião ou de um gestor);
 * 2. sessão de conta (`apupu_auth`) com acesso ao evento por posse ou
 *    por gestão (email verificado adicionado como gestor).
 *
 * O UUID do evento nunca é autorização por si só. Uma conta válida
 * mas sem acesso ao evento recebe 404 `event_not_found` (não revela a
 * existência do recurso); sem qualquer sessão válida, 401 genérico.
 *
 * O papel resolvido fica em `req.accessRole` para que as rotas possam
 * restringir operações ao anfitrião.
 */
export async function hostAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const eventId = req.params.eventId;

  if (!eventId) {
    next(new UnauthorizedError('Sessão de gestão inválida.', 'host_session_invalid'));
    return;
  }

  try {
    const legacyToken = readHostSession(req, eventId);

    if (legacyToken) {
      const authenticated = await hostSessionService.authenticate(legacyToken);

      if (authenticated && authenticated.session.eventId === eventId) {
        req.hostSession = {
          id: authenticated.session.id,
          eventId: authenticated.session.eventId,
          role: authenticated.session.role,
          managerId: authenticated.session.managerId,
          expiresAt: authenticated.session.expiresAt,
        };
        req.accessRole = authenticated.session.role;
        req.event = authenticated.event;
        next();
        return;
      }

      clearHostSession(res, eventId);
    }

    const accountToken = readAuthSession(req);

    if (!accountToken) {
      next(new UnauthorizedError('Sessão ausente ou expirada.', 'host_session_invalid'));
      return;
    }

    const session = await hostAuthSessionRepository.findActiveByTokenHash(
      hashToken(accountToken)
    );

    if (!session) {
      clearAuthSession(res);
      next(new UnauthorizedError('Sessão ausente ou expirada.', 'host_session_invalid'));
      return;
    }

    const host = await hostRepository.findById(session.hostId);

    if (!host || host.status !== 'active') {
      clearAuthSession(res);
      next(new UnauthorizedError('Sessão ausente ou expirada.', 'host_session_invalid'));
      return;
    }

    const access = await eventRepository.findByIdForAccess(eventId, {
      hostId: host.id,
      // Só uma conta com email verificado pode gerir eventos em que
      // foi adicionada como gestora. A comparação é feita por email.
      managerEmail: host.emailVerifiedAt ? host.email : null,
    });

    if (!access) {
      next(new NotFoundError('Evento não encontrado.', 'event_not_found'));
      return;
    }

    await hostAuthSessionRepository.touch(session.id);

    req.hostAccount = host;
    req.accountSession = {
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
    req.accessRole = access.accessRole;
    req.event = access.event;

    next();
  } catch (error) {
    next(error);
  }
}
