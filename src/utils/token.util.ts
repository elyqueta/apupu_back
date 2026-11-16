import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Geração e verificação de tokens opacos.
 *
 * Os tokens de gestão (anfitrião) e de convite (convidado) são
 * portadores de acesso: quem tem o link pode agir. Por isso:
 *
 * - são gerados com CSPRNG (`randomBytes`), nunca com `Math.random`;
 * - têm 256 bits de entropia, o que torna a adivinhação inviável;
 * - nunca são guardados em claro na base de dados — apenas o HMAC.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** HMAC-SHA256 do token com o pepper da aplicação. */
export function hashToken(token: string): string {
  return createHmac('sha256', env.TOKEN_PEPPER).update(token).digest('hex');
}

/**
 * Código OTP numérico de 6 dígitos.
 *
 * `randomInt` usa o CSPRNG do sistema; `padStart` preserva zeros à
 * esquerda (ex.: `004271`), mantendo sempre 6 dígitos.
 */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * HMAC do código OTP ligado ao email.
 *
 * O email entra no material HMAC para que um código de uma conta não
 * seja aceite noutra, mesmo que o código coincida.
 */
export function hashOtpCode(email: string, code: string): string {
  return hashToken(`${email.trim().toLowerCase()}:${code}`);
}

/**
 * Deriva o token CSRF de uma capacidade (sessão de gestão ou claim
 * de convite).
 *
 * Como o token da capacidade vive num cookie `HttpOnly`, um atacante
 * cross-site não o consegue ler nem derivar o CSRF correspondente.
 * O servidor recalcula o valor em cada pedido mutável e compara-o
 * com o cabeçalho enviado pelo frontend.
 */
export function csrfTokenFor(capabilityToken: string): string {
  return createHmac('sha256', env.TOKEN_PEPPER)
    .update(`csrf:${capabilityToken}`)
    .digest('hex');
}

/**
 * Comparação em tempo constante de dois hashes hexadecimais.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho; verificamos o
 * tamanho antes para não lançar em entradas malformadas.
 */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Comparação em tempo constante entre o CSRF esperado e o recebido. */
export function csrfMatches(expected: string, received: string): boolean {
  return hashesMatch(expected, received);
}

/** Identificador público curto e legível para respostas de erro/logs. */
export function shortId(): string {
  return randomBytes(6).toString('hex');
}
