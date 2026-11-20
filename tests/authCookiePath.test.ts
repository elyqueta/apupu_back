import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { clearAuthSession, setAuthSession } from '../src/utils/cookie.util';

interface CookieCall {
  name: string;
  value?: string;
  options: Record<string, unknown>;
}

function fakeResponse() {
  const cookies: CookieCall[] = [];
  return {
    cookies,
    cookie: vi.fn((name: string, value: string, options: Record<string, unknown>) => {
      cookies.push({ name, value, options });
    }),
    clearCookie: vi.fn((name: string, options: Record<string, unknown>) => {
      cookies.push({ name, options });
    }),
  };
}

/**
 * O refresh da SPA em desenvolvimento passa pelo SSR do Angular. O browser só
 * envia cookies cujo Path corresponda ao URL da página (`/painel`), por isso o
 * cookie de conta precisa de `Path=/` em dev. Fora de dev o comportamento tem
 * de continuar exactamente como antes (`Path=/api/v1`).
 */
describe('cookie de sessão da conta · Path', () => {
  afterEach(() => {
    env.NODE_ENV = 'test';
  });

  it('usa Path=/ em development para que o SSR veja a sessão no refresh', () => {
    env.NODE_ENV = 'development';
    const res = fakeResponse();

    setAuthSession(res as never, 'token-de-sessao');

    expect(res.cookies[0].name).toBe('apupu_auth');
    expect(res.cookies[0].options).toMatchObject({
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
    // O CSRF do escopo auth vem da resposta JSON, não de cookie.
    expect(res.cookies[1].name).toBe('apupu_csrf_auth');
    expect(res.cookies[1].options).toMatchObject({ path: '/api/v1', httpOnly: false });

    clearAuthSession(res as never);
    expect(res.cookies[2]).toMatchObject({ name: 'apupu_auth', options: { path: '/' } });
    expect(res.cookies[3]).toMatchObject({
      name: 'apupu_csrf_auth',
      options: { path: '/api/v1' },
    });
  });

  it('mantém Path=/api/v1 em produção', () => {
    env.NODE_ENV = 'production';
    const res = fakeResponse();

    setAuthSession(res as never, 'token-de-sessao');

    expect(res.cookies[0].options).toMatchObject({ path: '/api/v1', secure: true });
    clearAuthSession(res as never);
    expect(res.cookies[2].options).toMatchObject({ path: '/api/v1' });
  });

  it('mantém Path=/api/v1 em teste', () => {
    env.NODE_ENV = 'test';
    const res = fakeResponse();

    setAuthSession(res as never, 'token-de-sessao');

    expect(res.cookies[0].options).toMatchObject({ path: '/api/v1', secure: false });
  });
});
