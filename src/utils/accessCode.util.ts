import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Códigos de acesso de gestores.
 *
 * O alfabeto exclui caracteres ambíguos (I, O, 0, 1) para reduzir
 * erros ao digitar no telemóvel ou ao partilhar por WhatsApp. O código
 * em claro só é devolvido no momento da criação/regeneração: a BD
 * guarda apenas o HMAC com pepper e o id do gestor.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const DUMMY_MANAGER_ID = '00000000-0000-4000-8000-000000000000';

export function generateAccessCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Aceita minúsculas, espaços e hífens; devolve `XXX-XXX` para exibição. */
export function normalizeAccessCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function formatAccessCode(code: string): string {
  const normalized = normalizeAccessCode(code);
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}

export function hashAccessCode(code: string, managerId: string): string {
  return createHmac('sha256', env.TOKEN_PEPPER)
    .update(`${managerId}:${normalizeAccessCode(code)}`)
    .digest('hex');
}

/**
 * Comparação em tempo constante. O hash fictício é usado quando o
 * token não existe, para que o tempo de resposta seja equivalente.
 */
export function accessCodeMatches(provided: string, stored: string | null): boolean {
  const expected = stored ?? DUMMY_ACCESS_CODE_HASH;
  const providedBuffer = Buffer.from(provided, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export const DUMMY_ACCESS_CODE = generateAccessCode();
export const DUMMY_ACCESS_CODE_HASH = hashAccessCode(DUMMY_ACCESS_CODE, DUMMY_MANAGER_ID);
