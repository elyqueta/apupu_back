import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, NotFoundError } from '../errors';
import { readCsrfHeader, readGuestSession } from '../utils/cookie.util';
import { csrfMatches, csrfTokenFor } from '../utils/token.util';

/**
 * CSRF para o RSVP do convidado.
 *
 * A capacidade do navegador é HttpOnly; o valor CSRF derivado é
 * devolvido no claim/consulta e pode ser guardado em memória pelo
 * frontend. Um pedido cross-site não o consegue obter.
 */
export function requireGuestCsrf(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const capability = readGuestSession(req);

  if (!capability) {
    next(new NotFoundError('Convite não encontrado.', 'invitation_not_found'));
    return;
  }

  const received = readCsrfHeader(req);

  if (!received || !csrfMatches(csrfTokenFor(capability), received)) {
    next(new ForbiddenError('Token CSRF inválido ou ausente.', 'csrf_invalid'));
    return;
  }

  next();
}
