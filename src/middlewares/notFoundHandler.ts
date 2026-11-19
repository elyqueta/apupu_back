import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors';

/**
 * Converte qualquer rota não encontrada num `NotFoundError`, para
 * que a resposta use o mesmo envelope de erro do resto da API.
 */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  // A mensagem não inclui o caminho: um URL desconhecido pode conter
  // um token de convite e este texto é devolvido ao cliente.
  next(new NotFoundError('Rota não encontrada.', 'route_not_found'));
}
