import { NextFunction, Request, Response } from 'express';

/**
 * Impede caching de respostas da API.
 *
 * Respostas de gestão e de convite contêm dados pessoais e links
 * secretos. Um proxy ou o cache do browser a guardar isto poderia
 * expor informação a outro utilizador do mesmo dispositivo.
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}
