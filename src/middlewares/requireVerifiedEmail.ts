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

/**
 * Exige email verificado para "Meus convites".
 *
 * Sem verificação, uma conta criada com o email de outra pessoa
 * poderia ver convites alheios. A mensagem é própria desta área para
 * não confundir com as operações de gestão de eventos.
 */
export function requireVerifiedGuestEmail(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.hostAccount || !req.hostAccount.emailVerifiedAt) {
    next(
      new ForbiddenError(
        'Confirme o seu email para ver os seus convites.',
        'email_not_verified'
      )
    );
    return;
  }

  next();
}
