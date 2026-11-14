import { describe, expect, it } from 'vitest';
import {
  csrfMatches,
  csrfTokenFor,
  generateToken,
  hashesMatch,
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
});
