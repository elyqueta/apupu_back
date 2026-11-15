import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';
import { readAuthSession, readCsrfHeader, readHostSession } from '../utils/cookie.util';
import { csrfMatches, csrfTokenFor } from '../utils/token.util';

/**
 * CSRF para operações mutáveis autenticadas por cookie.
 *
 * Aceita os dois caminhos de gestão: a sessão legada por evento e a
 * sessão de conta. O token esperado é derivado do cookie HttpOnly que
 * autenticou o pedido; um site cross-site não o consegue ler nem
 * calcular. O cliente envia o valor em `X-CSRF-Token`.
 */
export function requireHostCsrf(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const eventId = req.params.eventId;
  const legacyToken = eventId ? readHostSession(req, eventId) : null;
  const accountToken = readAuthSession(req);

  const expected = [
    legacyToken ? csrfTokenFor(legacyToken) : null,
    accountToken ? csrfTokenFor(accountToken) : null,
  ].filter((value): value is string => value !== null);

  if (expected.length === 0) {
    next(new UnauthorizedError('Sessão ausente ou expirada.', 'host_session_invalid'));
    return;
  }

  const received = readCsrfHeader(req);

  if (!received || !expected.some((candidate) => csrfMatches(candidate, received))) {
    next(new ForbiddenError('Token CSRF inválido ou ausente.', 'csrf_invalid'));
    return;
  }

  next();
}
