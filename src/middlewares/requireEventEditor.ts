import { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../errors';

/**
 * Reserva a edição do evento a anfitriões e gestores.
 *
 * Membros activos da comunidade (`communityMember`) podem adicionar
 * convidados e exportar documentos, mas não alterar dados, capa ou
 * configuração do evento.
 */
export function requireEventEditor(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.accessRole === 'communityMember') {
    next(
      new ForbiddenError(
        'Apenas anfitriões e gestores podem alterar este evento.',
        'community_member_forbidden'
      )
    );
    return;
  }

  next();
}
