import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { links, publicAppBaseUrl } from '../src/utils/links.util';

const original = {
  APP_BASE_URL: env.APP_BASE_URL,
  CORS_ORIGIN: env.CORS_ORIGIN,
};

afterEach(() => {
  env.APP_BASE_URL = original.APP_BASE_URL;
  env.CORS_ORIGIN = original.CORS_ORIGIN;
});

describe('publicAppBaseUrl', () => {
  it('usa APP_BASE_URL quando já é público', () => {
    env.APP_BASE_URL = 'https://apupu-front.vercel.app/';
    env.CORS_ORIGIN = 'https://apupu-front.vercel.app';

    expect(publicAppBaseUrl()).toBe('https://apupu-front.vercel.app');
    expect(links.manageEvent('abc')).toBe('https://apupu-front.vercel.app/gerir/abc');
  });

  it('usa a primeira origem pública de CORS_ORIGIN quando APP_BASE_URL é local', () => {
    env.APP_BASE_URL = 'http://localhost:4200';
    env.CORS_ORIGIN = 'http://localhost:4200,https://apupu-front.vercel.app';

    // Ambientes de teste com NODE_ENV=development mantêm a docs acessível,
    // mas não podem enviar links de convite apontando para localhost.
    expect(publicAppBaseUrl()).toBe('https://apupu-front.vercel.app');
    expect(links.invitation('tok')).toBe(
      'https://apupu-front.vercel.app/convite/tok'
    );
    expect(links.verifyEmail('tok')).toBe(
      'https://apupu-front.vercel.app/verificar-email/tok'
    );
    expect(links.resetPassword('tok')).toBe(
      'https://apupu-front.vercel.app/redefinir-senha?token=tok'
    );
    expect(links.login()).toBe('https://apupu-front.vercel.app/entrar');
  });

  it('mantém localhost quando não há nenhuma origem pública', () => {
    env.APP_BASE_URL = 'http://localhost:4200';
    env.CORS_ORIGIN = 'http://localhost:4200,http://127.0.0.1:4200';

    expect(publicAppBaseUrl()).toBe('http://localhost:4200');
  });
});
