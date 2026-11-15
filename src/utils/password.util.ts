import { Algorithm, hash, verify } from '@node-rs/argon2';
import { env } from '../config/env';

/**
 * Política e hashing de senhas.
 *
 * Argon2id é o algoritmo recomendado para senhas. Os parâmetros vêm do
 * ambiente para poderem ser endurecidos em produção sem alterar código.
 * A senha em claro nunca é persistida, registada ou devolvida.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: env.ARGON2_MEMORY_KIB,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Lista mínima de senhas comuns. Não substitui uma lista completa
 * (ex.: Have I Been Pwned), mas bloqueia as escolhas mais óbvias.
 */
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'password123',
  'qwerty123',
  'qwertyuiop',
  'abc12345',
  '11111111',
  '00000000',
  'iloveyou',
  'admin123',
  'letmein1',
  'welcome1',
  'apupu123',
  'apupu2026',
  'senha123',
  'senha1234',
  'contraseña',
  'utilizador',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push(`A senha não pode exceder ${PASSWORD_MAX_LENGTH} caracteres.`);
  }

  if (isCommonPassword(password)) {
    issues.push('Escolha uma senha menos comum.');
  }

  return issues;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password, ARGON2_OPTIONS);
  } catch {
    // Hash malformado ou parâmetros incompatíveis: trata-se como
    // credencial inválida, sem expor a causa.
    return false;
  }
}

/**
 * Hash descartável usado quando o email não existe.
 *
 * Verificar contra ele mantém o tempo de resposta semelhante ao de um
 * email existente e reduz a enumeração por temporização.
 */
let dummyHashPromise: Promise<string> | null = null;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHashPromise ??= hash('apupu-dummy-password', ARGON2_OPTIONS);
  const dummy = await dummyHashPromise;
  await verifyPassword(dummy, password);
  return false;
}
