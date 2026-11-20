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

/** Cookies efetivamente escritos (os de limpeza não têm `value`). */
function written(cookies: CookieCall[], name: string): CookieCall | undefined {
  return cookies.find((cookie) => cookie.name === name && cookie.value !== undefined);
}

/** Confirma que o legado `Path=/api/v1` é apagado mesmo quando não é o atual. */
function expectLegacyCleared(cookies: CookieCall[]): void {
  expect(cookies).toContainEqual({
    name: 'apupu_auth',
    options: { path: '/api/v1' },
  });
  expect(cookies).toContainEqual({
    name: 'apupu_csrf_auth',
    options: { path: '/api/v1' },
  });
}

/**
 * O refresh da SPA em desenvolvimento passa pelo SSR do Angular. O browser só
 * envia cookies cujo Path corresponda ao URL da página (`/painel`), por isso o
 * cookie de conta precisa de `Path=/` em dev. Fora de dev o comportamento tem
 * de continuar exactamente como antes (`Path=/api/v1`).
 *
 * Em todos os ambientes é obrigatório limpar as duas variantes de Path: um
 * cookie antigo com `Path=/api/v1` é enviado primeiro pelo browser e fazia o
 * `hostAccountAuth` ler um token revogado depois de um novo login.
 */
describe('cookie de sessão da conta · Path', () => {
  afterEach(() => {
    env.NODE_ENV = 'test';
  });

  it('usa Path=/ em development para que o SSR veja a sessão no refresh', () => {
    env.NODE_ENV = 'development';
    const res = fakeResponse();

    setAuthSession(res as never, 'token-de-sessao');

    const auth = written(res.cookies, 'apupu_auth');
    expect(auth?.options).toMatchObject({
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
    expect(written(res.cookies, 'apupu_csrf_auth')?.options).toMatchObject({
      path: '/api/v1',
      httpOnly: false,
    });
    // O cookie antigo tem de ser apagado antes de escrever o novo.
    expectLegacyCleared(res.cookies);
    expect(res.cookies.findIndex((c) => c.name === 'apupu_auth' && !c.value)).toBeLessThan(
      res.cookies.indexOf(auth as CookieCall),
    );

    clearAuthSession(res as never);
    expectLegacyCleared(res.cookies);
    expect(res.cookies).toContainEqual({ name: 'apupu_auth', options: { path: '/' } });
  });

  it('mantém Path=/api/v1 em produção e limpa também a variante /', () => {
    env.NODE_ENV = 'production';
    const res = fakeResponse();

    setAuthSession(res as never, 'token-de-sessao');

    expect(written(res.cookies, 'apupu_auth')?.options).toMatchObject({
      path: '/api/v1',
      secure: true,
    });
    expect(res.cookies).toContainEqual({ name: 'apupu_auth', options: { path: '/' } });

    clearAuthSession(res as never);
    expect(res.cookies).toContainEqual({ name: 'apupu_auth', options: { path: '/api/v1' } });
  });

  it('mantém Path=/api/v1 em teste', () => {
    env.NODE_ENV = 'test';
    const res = fakeResponse();

    setAuthSession(res as never, 'token-de-sessao');

    expect(written(res.cookies, 'apupu_auth')?.options).toMatchObject({
      path: '/api/v1',
      secure: false,
    });
    expectLegacyCleared(res.cookies);
  });
});
