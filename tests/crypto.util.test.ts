import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../src/utils/crypto.util';

describe('crypto.util', () => {
  it('cifra e decifra um token', () => {
    const token = 'token-secreto-de-convite-1234567890';
    const encrypted = encryptToken(token);

    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it('gera cifras diferentes para o mesmo token (IV aleatório)', () => {
    const token = 'token-secreto';
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it('rejeita payload adulterado', () => {
    const encrypted = encryptToken('token-secreto');
    const parts = encrypted.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -2)}AA`;

    expect(() => decryptToken(tampered)).toThrow();
  });

  it('rejeita formato inválido', () => {
    expect(() => decryptToken('sem-partes')).toThrow();
  });
});
