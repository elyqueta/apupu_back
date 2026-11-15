import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors';
import { hostAuthSessionRepository } from '../repositories/hostAuthSession.repository';
import { hostRepository } from '../repositories/host.repository';
import { clearAuthSession, readAuthSession } from '../utils/cookie.util';
import { hashToken } from '../utils/token.util';

/**
 * Autentica a conta do anfitrião através do cookie `apupu_auth`.
 *
 * O `host_id` nunca vem do pedido: vem sempre da sessão. Qualquer
 * falha (sem cookie, sessão revogada/expirada, conta suspensa) devolve
 * o mesmo 401 genérico.
 */
export async function hostAccountAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionToken = readAuthSession(req);

    if (!sessionToken) {
      next(new UnauthorizedError('Sessão inválida ou expirada.', 'host_session_invalid'));
      return;
    }

    const session = await hostAuthSessionRepository.findActiveByTokenHash(
      hashToken(sessionToken)
    );

    if (!session) {
      clearAuthSession(res);
      next(new UnauthorizedError('Sessão inválida ou expirada.', 'host_session_invalid'));
      return;
    }

    const host = await hostRepository.findById(session.hostId);

    if (!host || host.status !== 'active') {
      clearAuthSession(res);
      next(new UnauthorizedError('Sessão inválida ou expirada.', 'host_session_invalid'));
      return;
    }

    await hostAuthSessionRepository.touch(session.id);

    req.hostAccount = host;
    req.accountSession = {
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };

    next();
  } catch (error) {
    next(error);
  }
}
