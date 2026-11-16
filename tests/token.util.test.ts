import { describe, expect, it } from 'vitest';
import {
  csrfMatches,
  csrfTokenFor,
  generateOtpCode,
  generateToken,
  hashesMatch,
  hashOtpCode,
  hashToken,
} from '../src/utils/token.util';

describe('token.util', () => {
  it('gera tokens distintos com entropia suficiente', () => {
    const a = generateToken();
    const b = generateToken();

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('produz o mesmo hash para o mesmo token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produz hashes diferentes para tokens diferentes', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });

  it('compara hashes em tempo constante', () => {
    const token = generateToken();
    const hash = hashToken(token);

    expect(hashesMatch(hash, hash)).toBe(true);
    expect(hashesMatch(hash, hashToken(generateToken()))).toBe(false);
    expect(hashesMatch(hash, 'curto')).toBe(false);
  });

  it('deriva um CSRF estável e distinto por capacidade', () => {
    const capability = generateToken();

    expect(csrfTokenFor(capability)).toBe(csrfTokenFor(capability));
    expect(csrfTokenFor(capability)).not.toBe(csrfTokenFor(generateToken()));
    expect(csrfTokenFor(capability)).not.toBe(hashToken(capability));
  });

  it('compara o CSRF recebido com o esperado', () => {
    const capability = generateToken();
    const expected = csrfTokenFor(capability);

    expect(csrfMatches(expected, expected)).toBe(true);
    expect(csrfMatches(expected, csrfTokenFor(generateToken()))).toBe(false);
  });

  it('gera códigos OTP de 6 dígitos', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('liga o hash do OTP ao email normalizado', () => {
    const code = '004271';
    const hash = hashOtpCode('ana@exemplo.ao', code);

    expect(hashOtpCode('  ANA@Exemplo.AO ', code)).toBe(hash);
    expect(hashOtpCode('outra@exemplo.ao', code)).not.toBe(hash);
    expect(hashOtpCode('ana@exemplo.ao', '004272')).not.toBe(hash);
  });
});
