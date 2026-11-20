import { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../errors';

/**
 * Autoriza apenas contas de super admin.
 *
 * É aplicado depois de `hostAccountAuth`. O `is_super_admin` vem da
 * base de dados na sessão autenticada — nunca do corpo ou de um header.
 */
export function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.hostAccount?.isSuperAdmin) {
    next(
      new ForbiddenError(
        'Esta área está reservada ao responsável da plataforma.',
        'admin_forbidden'
      )
    );
    return;
  }

  next();
}

/** Impede que o admin suspenda a própria conta ou altere o próprio papel. */
export function assertNotSelf(adminId: string, targetId: string): void {
  if (adminId === targetId) {
    throw new ForbiddenError(
      'Não podes alterar a tua própria conta ou o teu papel.',
      'admin_self_action'
    );
  }
}
