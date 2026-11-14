import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors';
import { hostSessionService } from '../services/hostSession.service';
import { clearHostSession, readHostSession } from '../utils/cookie.util';

/**
 * Autoriza operações de gestão através da sessão HttpOnly.
 *
 * O UUID do evento nunca é autorização: a sessão tem de existir, não
 * estar expirada/revogada e pertencer exactamente ao `eventId` da
 * rota. Qualquer falha devolve o mesmo 401 genérico.
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

  const sessionToken = readHostSession(req, eventId);

  if (!sessionToken) {
    next(new UnauthorizedError('Sessão de gestão ausente ou expirada.', 'host_session_invalid'));
    return;
  }

  const authenticated = await hostSessionService.authenticate(sessionToken);

  if (!authenticated || authenticated.session.eventId !== eventId) {
    clearHostSession(res, eventId);
    next(new UnauthorizedError('Sessão de gestão ausente ou expirada.', 'host_session_invalid'));
    return;
  }

  req.hostSession = {
    id: authenticated.session.id,
    eventId: authenticated.session.eventId,
    expiresAt: authenticated.session.expiresAt,
  };
  req.event = authenticated.event;

  next();
}
