import { NextFunction, Request, Response } from 'express';

/**
 * Cabeçalhos obrigatórios nas páginas e respostas públicas de convites.
 *
 * Os URLs destas rotas contêm o token em claro. `Referrer-Policy:
 * no-referrer` impede que o browser o envie a terceiros (imagens,
 * scripts, links externos) e `Cache-Control: no-store` impede que
 * proxies ou o histórico de cache guardem a resposta.
 *
 * Aplica-se a todas as respostas, incluindo erros: o `errorHandler`
 * também usa `no-store`.
 */
export function publicInviteHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}
