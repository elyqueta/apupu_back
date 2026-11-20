import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ForbiddenError, UnauthorizedError } from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { hostSessionService, isManagerLinkValid } from '../services/hostSession.service';
import { readCsrfHeader } from '../utils/cookie.util';
import { csrfMatches, csrfTokenFor } from '../utils/token.util';

/**
 * Autentica um gestor que entrou por link + código, sem exigir conta.
 *
 * A sessão de gestão é um cookie `apupu_host_<eventId>` com CSRF
 * derivado. Como esta rota não tem `eventId` no caminho, procuramos o
 * cookie pelo prefixo e validamos a sessão antes de confiar no gestor.
 */
export async function managerSessionAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const prefix = `${env.HOST_COOKIE_NAME}_`;
  const receivedCsrf = readCsrfHeader(req);

  for (const [name, value] of Object.entries(cookies ?? {})) {
    if (!name.startsWith(prefix) || typeof value !== 'string' || value.length === 0) continue;

    const eventId = name.slice(prefix.length);
    const authenticated = await hostSessionService.authenticate(value);

    if (
      !authenticated ||
      authenticated.session.eventId !== eventId ||
      authenticated.session.role !== 'manager' ||
      !authenticated.session.managerId
    ) {
      continue;
    }

    if (!receivedCsrf || !csrfMatches(csrfTokenFor(value), receivedCsrf)) {
      next(new ForbiddenError('Token CSRF inválido ou ausente.', 'csrf_invalid'));
      return;
    }

    const manager = await eventManagerRepository.findById(authenticated.session.managerId);

    if (!manager || !isManagerLinkValid(manager)) continue;

    req.hostSession = {
      id: authenticated.session.id,
      eventId: authenticated.event.id,
      role: 'manager',
      managerId: manager.id,
      expiresAt: authenticated.session.expiresAt,
    };
    req.event = authenticated.event;
    req.accessRole = 'manager';
    req.managerContact = {
      email: manager.email,
      phone: manager.phone,
      displayName: manager.displayName,
    };

    next();
    return;
  }

  next(new UnauthorizedError('Sessão de gestão inválida.', 'host_session_invalid'));
}
