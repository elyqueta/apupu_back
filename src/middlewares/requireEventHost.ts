import { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../errors';

/**
 * Restringe a rota ao anfitrião (proprietário) do evento.
 *
 * Os gestores podem consultar o evento, adicionar convidados e editar
 * informações, mas não podem cancelar o evento, alterar o email do
 * anfitrião, gerir gestores ou manipular convites existentes. A
 * verificação usa o papel resolvido por `hostAuth`; nunca o UUID.
 */
export function requireEventHost(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.accessRole !== 'host') {
    next(
      new ForbiddenError(
        'Apenas o anfitrião pode executar esta ação.',
        'host_action_forbidden'
      )
    );
    return;
  }

  next();
}
