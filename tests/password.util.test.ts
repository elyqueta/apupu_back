import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  isCommonPassword,
  passwordPolicyIssues,
  verifyAgainstDummy,
  verifyPassword,
} from '../src/utils/password.util';

describe('política de senhas', () => {
  it('aceita uma senha suficientemente longa e não comum', () => {
    expect(passwordPolicyIssues('SenhaSegura#2026')).toEqual([]);
  });

  it('rejeita senhas demasiado curtas', () => {
    const issues = passwordPolicyIssues('a'.repeat(PASSWORD_MIN_LENGTH - 1));
    expect(issues).toContain(
      `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`
    );
  });

  it('rejeita senhas demasiado longas', () => {
    const issues = passwordPolicyIssues('a'.repeat(PASSWORD_MAX_LENGTH + 1));
    expect(issues).toContain(
      `A senha não pode exceder ${PASSWORD_MAX_LENGTH} caracteres.`
    );
  });

  it('rejeita senhas comuns sem distinguir maiúsculas', () => {
    expect(isCommonPassword('PASSWORD123')).toBe(true);
    expect(passwordPolicyIssues('Password123')).toContain('Escolha uma senha menos comum.');
  });
});

describe('hashing de senhas', () => {
  it('produz um hash Argon2id verificável e nunca guarda a senha em claro', async () => {
    const password = 'SenhaSegura#2026';
    const hashed = await hashPassword(password);

    expect(hashed).not.toBe(password);
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hashed, password)).resolves.toBe(true);
    await expect(verifyPassword(hashed, 'SenhaErrada#2026')).resolves.toBe(false);
  });

  it('trata um hash malformado como credencial inválida', async () => {
    await expect(verifyPassword('não-é-um-hash', 'qualquer')).resolves.toBe(false);
  });

  it('devolve sempre falso na verificação contra o hash descartável', async () => {
    await expect(verifyAgainstDummy('qualquer-senha')).resolves.toBe(false);
  });
});
