import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';
import { readCsrfHeader, readHostSession } from '../utils/cookie.util';
import { csrfMatches, csrfTokenFor } from '../utils/token.util';

/**
 * CSRF para operações mutáveis autenticadas por cookie.
 *
 * O token esperado é derivado da capacidade HttpOnly; um site
 * cross-site não consegue lê-la nem calcular o valor. O cliente envia
 * o token no cabeçalho `X-CSRF-Token`.
 */
export function requireHostCsrf(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const eventId = req.params.eventId;
  const sessionToken = eventId ? readHostSession(req, eventId) : null;

  if (!sessionToken) {
    next(new UnauthorizedError('Sessão de gestão ausente ou expirada.', 'host_session_invalid'));
    return;
  }

  const received = readCsrfHeader(req);

  if (!received || !csrfMatches(csrfTokenFor(sessionToken), received)) {
    next(new ForbiddenError('Token CSRF inválido ou ausente.', 'csrf_invalid'));
    return;
  }

  next();
}
