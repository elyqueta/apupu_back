import { Request, Response } from 'express';
import { env } from '../config/env';
import { csrfTokenFor } from './token.util';

/**
 * Cookies do produto.
 *
 * - `apupu_host_<eventId>` (HttpOnly): sessão de gestão de um evento,
 *   obtida ao trocar o segredo do link de gestão. O nome inclui o
 *   evento para que um anfitrião possa gerir vários eventos no mesmo
 *   navegador sem que uma sessão apague a outra.
 * - `apupu_guest` (HttpOnly): capacidade do navegador que reclamou um
 *   ou mais convites. É reutilizada para reclamar convites adicionais
 *   no mesmo navegador.
 * - `apupu_csrf_host_<eventId>` / `apupu_csrf_guest` (legíveis por
 *   JS): valores derivados das capacidades, exigidos no cabeçalho
 *   `X-CSRF-Token` em pedidos mutáveis. O mesmo valor é devolvido em
 *   JSON para clientes cross-origin que não consigam ler o cookie.
 */

const HOST_PATH = '/api/v1/host';
const GUEST_PATH = '/api/v1/public/invitations';
const CSRF_PATH = '/api/v1';

interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

function baseCookieOptions(path: string, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path,
    maxAge: maxAgeMs,
  };
}

function csrfCookieOptions(path: string, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path,
    maxAge: maxAgeMs,
  };
}

function hostCookieName(eventId: string): string {
  return `${env.HOST_COOKIE_NAME}_${eventId}`;
}

function hostCsrfCookieName(eventId: string): string {
  return `${env.CSRF_COOKIE_NAME}_host_${eventId}`;
}

function guestCsrfCookieName(): string {
  return `${env.CSRF_COOKIE_NAME}_guest`;
}

export function readHostSession(req: Request, eventId: string): string | null {
  const value: unknown = req.cookies?.[hostCookieName(eventId)];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setHostSession(res: Response, eventId: string, sessionToken: string): void {
  const maxAgeMs = env.HOST_SESSION_TTL_MINUTES * 60 * 1000;

  res.cookie(hostCookieName(eventId), sessionToken, baseCookieOptions(HOST_PATH, maxAgeMs));
  res.cookie(
    hostCsrfCookieName(eventId),
    csrfTokenFor(sessionToken),
    csrfCookieOptions(CSRF_PATH, maxAgeMs)
  );
}

export function clearHostSession(res: Response, eventId: string): void {
  res.clearCookie(hostCookieName(eventId), { path: HOST_PATH });
  res.clearCookie(hostCsrfCookieName(eventId), { path: CSRF_PATH });
}

export function readGuestSession(req: Request): string | null {
  const value: unknown = req.cookies?.[env.GUEST_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setGuestSession(res: Response, sessionToken: string): void {
  const maxAgeMs = env.GUEST_COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000;

  res.cookie(
    env.GUEST_COOKIE_NAME,
    sessionToken,
    baseCookieOptions(GUEST_PATH, maxAgeMs)
  );
  res.cookie(
    guestCsrfCookieName(),
    csrfTokenFor(sessionToken),
    csrfCookieOptions(CSRF_PATH, maxAgeMs)
  );
}

export function clearGuestSession(res: Response): void {
  res.clearCookie(env.GUEST_COOKIE_NAME, { path: GUEST_PATH });
  res.clearCookie(guestCsrfCookieName(), { path: CSRF_PATH });
}

export function readCsrfHeader(req: Request): string | null {
  const value = req.header(env.CSRF_HEADER_NAME);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/* ───────────────────────── Sessão de conta ───────────────────────── */

/**
 * Caminho do cookie de sessão da conta.
 *
 * Em desenvolvimento a SPA corre numa origem diferente da API
 * (`localhost:4200` vs `localhost:3000`) e o SSR do Angular precisa de ver o
 * cookie quando pede a própria página (por exemplo `/painel`) para
 * reautenticar. O browser só envia cookies cujo `Path` corresponda ao URL
 * pedido, por isso em dev o cookie usa `/`.
 *
 * Produção e teste (incluindo Vercel, onde a API serve `/api/v1` na mesma
 * origem) mantêm `/api/v1` — o comportamento não muda nesses ambientes.
 */
function authPath(): string {
  return env.NODE_ENV === 'development' ? '/' : '/api/v1';
}

/**
 * Caminhos já usados pelo cookie de conta ao longo do tempo.
 *
 * Até `f414b99` o cookie era sempre escrito com `Path=/api/v1`. A partir daí
 * passou a ser `Path=/` em desenvolvimento (para o SSR ver a sessão no refresh
 * da SPA). Como o browser envia primeiro os cookies com `Path` mais longo e o
 * `cookie-parser` guarda apenas o primeiro valor de cada nome, um cookie antigo
 * com `Path=/api/v1` continuava a ganhar ao novo. Resultado: o login Google
 * criava a sessão na BD, mas `/api/v1/auth/session` lia o token antigo e
 * devolvia `host_session_invalid`.
 */
const AUTH_COOKIE_PATHS = ['/', '/api/v1'] as const;

/** Apaga todas as variantes históricas antes de escrever/limpar a sessão. */
function clearAuthCookiesOnAllPaths(res: Response): void {
  for (const path of AUTH_COOKIE_PATHS) {
    res.clearCookie(env.AUTH_COOKIE_NAME, { path });
    res.clearCookie(env.AUTH_CSRF_COOKIE_NAME, { path });
  }
}

export function readAuthSession(req: Request): string | null {
  const value: unknown = req.cookies?.[env.AUTH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setAuthSession(res: Response, sessionToken: string): void {
  // Primeiro removemos o legado; caso contrário o cookie antigo com
  // `Path=/api/v1` continuaria a ser o primeiro enviado pelo browser.
  clearAuthCookiesOnAllPaths(res);

  const maxAgeMs = env.AUTH_SESSION_TTL_MINUTES * 60 * 1000;

  res.cookie(
    env.AUTH_COOKIE_NAME,
    sessionToken,
    baseCookieOptions(authPath(), maxAgeMs)
  );
  res.cookie(
    env.AUTH_CSRF_COOKIE_NAME,
    csrfTokenFor(sessionToken),
    csrfCookieOptions('/api/v1', maxAgeMs)
  );
}

export function clearAuthSession(res: Response): void {
  clearAuthCookiesOnAllPaths(res);
}
