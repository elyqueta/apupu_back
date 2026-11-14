import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors';

/**
 * Converte qualquer rota não encontrada num `NotFoundError`, para
 * que a resposta use o mesmo envelope de erro do resto da API.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Rota não encontrada: ${req.method} ${req.path}`, 'route_not_found'));
}
