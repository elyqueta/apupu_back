import { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../errors';

/**
 * Exige email verificado para criar/gerir eventos.
 *
 * O login continua permitido com email por verificar; só as operações
 * de escrita do workspace ficam bloqueadas até à verificação.
 */
export function requireVerifiedEmail(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.hostAccount || !req.hostAccount.emailVerifiedAt) {
    next(
      new ForbiddenError(
        'Confirme o seu email para criar ou gerir eventos.',
        'email_not_verified'
      )
    );
    return;
  }

  next();
}
