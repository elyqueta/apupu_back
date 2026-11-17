import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/auth.service', () => ({
  authService: { requestRegistrationCode: vi.fn(), register: vi.fn() },
}));

import { authController } from '../src/controllers/auth.controller';
import { env } from '../src/config/env';
import { toHostDto } from '../src/dto/host.dto';
import { authService } from '../src/services/auth.service';
import { csrfTokenFor } from '../src/utils/token.util';
import type { HostWithProfile } from '../src/types/host.types';

async function requestRegistrationCodeResponse(): Promise<Record<string, unknown>> {
  const json = vi.fn();
  const response = {
    status: vi.fn(() => ({ json })),
    json,
  } as unknown as Response;

  await authController.requestRegistrationCode(
    {
      body: { email: 'ana@example.test' },
      ip: '127.0.0.1',
      id: 'test-request',
    } as Request,
    response
  );

  return json.mock.calls[0][0] as Record<string, unknown>;
}

describe('authController.requestRegistrationCode', () => {
  beforeEach(() => {
    vi.mocked(authService.requestRegistrationCode).mockResolvedValue({
      expiresAt: new Date('2026-11-16T04:00:00.000Z'),
      resendAvailableAt: new Date('2026-11-16T03:51:00.000Z'),
      code: '004271',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    env.NODE_ENV = 'test';
  });

  it('nunca inclui o código OTP na resposta, mesmo fora de produção', async () => {
    const body = (await requestRegistrationCodeResponse()) as {
      data: Record<string, unknown>;
    };

    expect(body.data).toMatchObject({
      status: 'accepted',
      email: 'ana@example.test',
    });
    expect(body.data).not.toHaveProperty('dev_code');
    expect(body.data).not.toHaveProperty('code');
    expect(JSON.stringify(body)).not.toContain('004271');
  });

  it('em produção nunca inclui o código OTP na resposta', async () => {
    env.NODE_ENV = 'production';

    const body = (await requestRegistrationCodeResponse()) as {
      data: Record<string, unknown>;
    };

    expect(body.data).not.toHaveProperty('dev_code');
    expect(body.data).not.toHaveProperty('code');
    expect(JSON.stringify(body)).not.toContain('004271');
  });
});

describe('authController.register', () => {
  it('inicia sessão por cookie e não devolve o token da sessão em JSON', async () => {
    const sessionToken = 'opaque-session-token';
    const csrfToken = csrfTokenFor(sessionToken);
    const expiresAt = new Date('2026-11-16T04:00:00.000Z');
    const json = vi.fn();
    const cookie = vi.fn();
    const response = {
      status: vi.fn(() => ({ json })),
      json,
      cookie,
    } as unknown as Response;
    const host: HostWithProfile = {
      id: 'host-id',
      email: 'ana@example.test',
      passwordHash: 'password-hash',
      emailVerifiedAt: expiresAt,
      status: 'active',
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: expiresAt,
      updatedAt: expiresAt,
      profile: {
        hostId: 'host-id',
        displayName: 'Ana',
        phone: null,
        birthDate: null,
        locale: 'pt-AO',
        timezone: 'Africa/Luanda',
        avatarUrl: null,
        coverUrl: null,
        coverHash: null,
        coverPublicId: null,
        createdAt: expiresAt,
        updatedAt: expiresAt,
      },
    };

    vi.mocked(authService.register).mockResolvedValue({
      host,
      session: {
        session: {
          id: 'session-id',
          hostId: host.id,
          tokenHash: 'token-hash',
          csrfHash: 'csrf-hash',
          userAgentHash: null,
          expiresAt,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: expiresAt,
        },
        sessionToken,
        csrfToken,
        expiresAt,
      },
    });

    await authController.register(
      {
        body: {
          email: 'ana@example.test',
          password: 'strong-password',
          verification_token: 'verified-registration-token',
        },
        header: vi.fn(() => 'test-agent'),
        ip: '127.0.0.1',
        id: 'test-request',
      } as unknown as Request,
      response
    );

    expect(authService.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@example.test' }),
      'test-agent',
      { ip: '127.0.0.1', requestId: 'test-request' }
    );
    expect(cookie).toHaveBeenNthCalledWith(
      1,
      env.AUTH_COOKIE_NAME,
      sessionToken,
      expect.objectContaining({ httpOnly: true, path: '/api/v1' })
    );
    expect(cookie).toHaveBeenNthCalledWith(
      2,
      env.AUTH_CSRF_COOKIE_NAME,
      csrfToken,
      expect.objectContaining({ httpOnly: false, path: '/api/v1' })
    );
    expect(response.status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      data: {
        host: toHostDto(host),
        csrf_token: csrfToken,
        expires_at: expiresAt.toISOString(),
      },
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(sessionToken);
  });
});
