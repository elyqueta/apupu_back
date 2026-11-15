import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';
import { readAuthSession, readCsrfHeader } from '../utils/cookie.util';
import { csrfMatches, csrfTokenFor } from '../utils/token.util';

/**
 * CSRF das rotas autenticadas pela conta (`apupu_auth`).
 *
 * O valor esperado é derivado do token de sessão HttpOnly; um site
 * cross-site não o consegue ler. O cliente envia-o em
 * `X-CSRF-Token`.
 */
export function requireAuthCsrf(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const sessionToken = readAuthSession(req);

  if (!sessionToken) {
    next(new UnauthorizedError('Sessão inválida ou expirada.', 'host_session_invalid'));
    return;
  }

  const received = readCsrfHeader(req);

  if (!received || !csrfMatches(csrfTokenFor(sessionToken), received)) {
    next(new ForbiddenError('Token CSRF inválido ou ausente.', 'csrf_invalid'));
    return;
  }

  next();
}
