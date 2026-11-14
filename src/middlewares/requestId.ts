import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
const MAX_LENGTH = 128;
const SAFE_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Atribui um identificador a cada pedido.
 *
 * - Reutiliza o `X-Request-Id` do cliente/proxy quando é seguro
 *   (curto e com caracteres previsíveis); caso contrário gera um.
 * - Devolve sempre o id no cabeçalho de resposta.
 * - O `errorHandler` inclui-o no envelope de erro, permitindo
 *   correlacionar a resposta pública com o log interno sem expor PII.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const candidate =
    incoming && incoming.length <= MAX_LENGTH && SAFE_PATTERN.test(incoming)
      ? incoming
      : randomUUID();

  req.id = candidate;
  res.setHeader('X-Request-Id', candidate);
  next();
}
