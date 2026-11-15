import { rateLimit } from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Resposta de rate limit no mesmo envelope do errorHandler.
 *
 * O limiter responde antes de chegar às rotas, por isso não pode
 * delegar no errorHandler — mas o formato tem de ser idêntico.
 */
function limitHandler(req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: 'rate_limited',
      message: 'Demasiados pedidos. Tente novamente mais tarde.',
      request_id: req.id ?? 'unknown',
    },
  });
}

/** Limite global de `/api/v1`. */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

/**
 * Limite específico para endpoints públicos que recebem tokens.
 *
 * Protege contra enumeração/adivinhação de links. É aplicado sempre
 * (não só em produção), porque a superfície de ataque existe em
 * qualquer ambiente exposto.
 */
export const publicTokenLimiter = rateLimit({
  windowMs: env.PUBLIC_RATE_LIMIT_WINDOW_MS,
  limit: env.PUBLIC_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

/**
 * Limite para a troca do segredo de gestão por sessão.
 *
 * Mais restrito do que o global: é o ponto onde um segredo bearer
 * pode ser tentado repetidamente.
 */
export const hostSessionLimiter = rateLimit({
  windowMs: env.HOST_SESSION_RATE_LIMIT_WINDOW_MS,
  limit: env.HOST_SESSION_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

function requestEmail(req: Request): string {
  const value = (req.body as { email?: unknown } | undefined)?.email;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Limite dedicado por IP para registo, login e reposição de senha.
 *
 * Complementa o limite global: um atacante que rode IPs diferentes
 * ainda é travado pelo limite por email.
 */
export const authIpLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

/**
 * Limite por IP + email.
 *
 * O email é lido do corpo já interpretado; quando ausente, cai para o
 * IP, para que o limite nunca fique sem chave.
 */
export const authEmailLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip ?? 'unknown'}:${requestEmail(req)}`,
  handler: limitHandler,
});
