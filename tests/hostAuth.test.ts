import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/hostSession.service', () => ({
  hostSessionService: { authenticate: vi.fn() },
}));

vi.mock('../src/repositories/hostAuthSession.repository', () => ({
  hostAuthSessionRepository: {
    findActiveByTokenHash: vi.fn(),
    touch: vi.fn(),
  },
}));

vi.mock('../src/repositories/host.repository', () => ({
  hostRepository: { findById: vi.fn() },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findByIdForHost: vi.fn() },
}));

import { env } from '../src/config/env';
import { hostAuth } from '../src/middlewares/hostAuth';
import { requireHostCsrf } from '../src/middlewares/requireHostCsrf';
import { eventRepository } from '../src/repositories/event.repository';
import { hostAuthSessionRepository } from '../src/repositories/hostAuthSession.repository';
import { hostRepository } from '../src/repositories/host.repository';
import { hostSessionService } from '../src/services/hostSession.service';
import { csrfTokenFor } from '../src/utils/token.util';
import { EventRecord } from '../src/types/event.types';
import { HostAuthSession, HostWithProfile } from '../src/types/host.types';
import { HostSession } from '../src/types/hostSession.types';

const EVENT_ID = '2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec';
const OTHER_EVENT_ID = '11111111-1111-4111-8111-111111111111';

const now = new Date('2026-11-15T10:00:00.000Z');

const host = {
  id: 'host-1',
  email: 'ana@exemplo.ao',
  passwordHash: 'hash',
  emailVerifiedAt: now,
  status: 'active',
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: now,
  updatedAt: now,
  profile: {
    hostId: 'host-1',
    displayName: null,
    phone: null,
    birthDate: null,
    locale: 'pt-AO',
    timezone: 'Africa/Luanda',
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  },
} as HostWithProfile;

const accountSession = {
  id: 'account-session-1',
  hostId: host.id,
  tokenHash: 'token-hash',
  csrfHash: 'csrf-hash',
  userAgentHash: null,
  expiresAt: new Date('2026-11-22T10:00:00.000Z'),
  revokedAt: null,
  lastUsedAt: null,
  createdAt: now,
} as HostAuthSession;

const event = {
  id: EVENT_ID,
  hostId: host.id,
  title: 'Evento QA',
} as EventRecord;

const legacySession = {
  id: 'legacy-session-1',
  eventId: EVENT_ID,
  tokenHash: 'legacy-hash',
  expiresAt: new Date('2026-11-15T12:00:00.000Z'),
  revokedAt: null,
  createdAt: now,
  lastUsedAt: null,
} as HostSession;

function makeRequest(cookies: Record<string, string>): Request {
  return {
    params: { eventId: EVENT_ID },
    cookies,
    header: () => undefined,
  } as unknown as Request;
}

function makeResponse(): Response {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
}

function makeNext(): NextFunction & ReturnType<typeof vi.fn> {
  return vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
}

function errorFrom(next: ReturnType<typeof makeNext>): { code?: string } | undefined {
  return next.mock.calls[0]?.[0] as { code?: string } | undefined;
}

describe('hostAuth — autorização combinada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hostAuthSessionRepository.touch).mockResolvedValue(undefined);
  });

  it('aceita uma sessão legada válida do próprio evento', async () => {
    vi.mocked(hostSessionService.authenticate).mockResolvedValue({
      session: legacySession,
      event,
    });

    const req = makeRequest({ [`${env.HOST_COOKIE_NAME}_${EVENT_ID}`]: 'legacy-token' });
    const res = makeResponse();
    const next = makeNext();

    await hostAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.event).toBe(event);
    expect(req.hostSession).toEqual({
      id: legacySession.id,
      eventId: EVENT_ID,
      expiresAt: legacySession.expiresAt,
    });
    expect(hostAuthSessionRepository.findActiveByTokenHash).not.toHaveBeenCalled();
  });

  it('ignora uma sessão legada de outro evento e exige conta', async () => {
    vi.mocked(hostSessionService.authenticate).mockResolvedValue({
      session: { ...legacySession, eventId: OTHER_EVENT_ID },
      event,
    });

    const req = makeRequest({ [`${env.HOST_COOKIE_NAME}_${EVENT_ID}`]: 'legacy-token' });
    const res = makeResponse();
    const next = makeNext();

    await hostAuth(req, res, next);

    expect(errorFrom(next)?.code).toBe('host_session_invalid');
    expect(res.clearCookie).toHaveBeenCalled();
    expect(req.event).toBeUndefined();
  });

  it('aceita uma conta proprietária do evento', async () => {
    vi.mocked(hostSessionService.authenticate).mockResolvedValue(null);
    vi.mocked(hostAuthSessionRepository.findActiveByTokenHash).mockResolvedValue(accountSession);
    vi.mocked(hostRepository.findById).mockResolvedValue(host);
    vi.mocked(eventRepository.findByIdForHost).mockResolvedValue(event);

    const req = makeRequest({ [env.AUTH_COOKIE_NAME]: 'account-token' });
    const res = makeResponse();
    const next = makeNext();

    await hostAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.hostAccount).toBe(host);
    expect(req.accountSession).toEqual({
      sessionId: accountSession.id,
      expiresAt: accountSession.expiresAt,
    });
    expect(req.event).toBe(event);
    expect(eventRepository.findByIdForHost).toHaveBeenCalledWith(EVENT_ID, host.id);
  });

  it('aceita CSRF da sessão de conta sem cookie/token de gestão do evento', () => {
    const accountToken = 'account-token';
    const req = {
      params: { eventId: EVENT_ID },
      cookies: { [env.AUTH_COOKIE_NAME]: accountToken },
      header: (name: string) =>
        name === env.CSRF_HEADER_NAME ? csrfTokenFor(accountToken) : undefined,
    } as unknown as Request;
    const next = makeNext();

    requireHostCsrf(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('devolve 404 quando a conta não é proprietária do evento', async () => {
    vi.mocked(hostSessionService.authenticate).mockResolvedValue(null);
    vi.mocked(hostAuthSessionRepository.findActiveByTokenHash).mockResolvedValue(accountSession);
    vi.mocked(hostRepository.findById).mockResolvedValue(host);
    vi.mocked(eventRepository.findByIdForHost).mockResolvedValue(null);

    const req = makeRequest({ [env.AUTH_COOKIE_NAME]: 'account-token' });
    const res = makeResponse();
    const next = makeNext();

    await hostAuth(req, res, next);

    expect(errorFrom(next)?.code).toBe('event_not_found');
    expect(req.event).toBeUndefined();
  });

  it('devolve 401 sem qualquer sessão', async () => {
    vi.mocked(hostSessionService.authenticate).mockResolvedValue(null);

    const req = makeRequest({});
    const res = makeResponse();
    const next = makeNext();

    await hostAuth(req, res, next);

    expect(errorFrom(next)?.code).toBe('host_session_invalid');
  });

  it('devolve 401 e limpa o cookie quando a conta está suspensa', async () => {
    vi.mocked(hostSessionService.authenticate).mockResolvedValue(null);
    vi.mocked(hostAuthSessionRepository.findActiveByTokenHash).mockResolvedValue(accountSession);
    vi.mocked(hostRepository.findById).mockResolvedValue({ ...host, status: 'suspended' });

    const req = makeRequest({ [env.AUTH_COOKIE_NAME]: 'account-token' });
    const res = makeResponse();
    const next = makeNext();

    await hostAuth(req, res, next);

    expect(errorFrom(next)?.code).toBe('host_session_invalid');
    expect(res.clearCookie).toHaveBeenCalled();
  });
});
