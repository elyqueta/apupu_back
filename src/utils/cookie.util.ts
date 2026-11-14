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
