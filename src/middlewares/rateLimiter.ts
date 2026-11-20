import { rateLimit } from 'express-rate-limit';
import { Request, RequestHandler, Response } from 'express';
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
 * Limite por IP e por acção nas rotas públicas de convites de equipa.
 *
 * Cada acção (`preview`, `accept`, `report`) tem o seu próprio balde:
 * abrir a página de confirmação de denúncia não consome o limite da
 * aceitação, e vice-versa. O limite é aplicado antes da validação do
 * token, para que pedidos inválidos também contem.
 */
function teamInviteLimiter(action: 'preview' | 'accept' | 'report'): RequestHandler {
  return rateLimit({
    windowMs: env.TEAM_INVITE_RATE_LIMIT_WINDOW_MS,
    limit: env.TEAM_INVITE_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) =>
      `team-invite:${action}:${req.ip ?? 'unknown'}`,
    handler: limitHandler,
  });
}

export const teamInvitePreviewLimiter = teamInviteLimiter('preview');
export const teamInviteAcceptLimiter = teamInviteLimiter('accept');
export const teamInviteReportLimiter = teamInviteLimiter('report');

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

/**
 * Limite adicional por IP para a entrada com link + código.
 *
 * Complementa as regras por link (5 falhas bloqueiam, 15 revogam) e
 * impede que um mesmo endereço rode códigos contra vários links.
 */
export const manageAccessLimiter = rateLimit({
  windowMs: env.HOST_SESSION_RATE_LIMIT_WINDOW_MS,
  limit: env.HOST_SESSION_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `manage-access:${req.ip ?? 'unknown'}`,
  handler: limitHandler,
});

/**
 * Chave do limite de escritas.
 *
 * É aplicado depois da autenticação, por isso prefere a identidade
 * estável (conta ou evento) ao IP. Sem identidade — por exemplo, na
 * criação pública de eventos — cai para o IP.
 */
function writeKey(req: Request): string {
  if (req.hostAccount) return `host:${req.hostAccount.id}`;
  if (req.event) return `event:${req.event.id}`;
  if (req.invitation) return `invitation:${req.invitation.id}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * Limite para operações de escrita: criar/remover eventos, adicionar,
 * alterar, remover e reenviar convites.
 */
export const writeLimiter = rateLimit({
  windowMs: env.WRITE_RATE_LIMIT_WINDOW_MS,
  limit: env.WRITE_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: writeKey,
  handler: limitHandler,
});

/**
 * Limite específico do RSVP público, por IP + token de convite.
 *
 * Complementa o limite público de tokens para que uma capacidade
 * válida não possa ser usada para alternar o estado em ciclo.
 */
export const rsvpLimiter = rateLimit({
  windowMs: env.RSVP_RATE_LIMIT_WINDOW_MS,
  limit: env.RSVP_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `rsvp:${req.ip ?? 'unknown'}:${req.params.token ?? 'unknown'}`,
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

/**
 * Limites dedicados das acções administrativas e dos OTP de
 * cancelamento. A chave usa a conta autenticada quando existe, para
 * que a quota não seja contornada pela troca de IP.
 */
function adminKey(req: Request): string {
  return `admin:${req.hostAccount?.id ?? req.ip ?? 'unknown'}`;
}

export const adminOtpLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminKey,
  handler: limitHandler,
});

export const adminActionLimiter = rateLimit({
  windowMs: env.WRITE_RATE_LIMIT_WINDOW_MS,
  limit: env.WRITE_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminKey,
  handler: limitHandler,
});
