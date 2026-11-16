import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/auth.service', () => ({
  authService: { requestRegistrationCode: vi.fn() },
}));

import { env } from '../src/config/env';
import { authController } from '../src/controllers/auth.controller';
import { authService } from '../src/services/auth.service';

const originalNodeEnv = env.NODE_ENV;
const originalEmailTransport = env.EMAIL_TRANSPORT;

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
    env.NODE_ENV = originalNodeEnv;
    env.EMAIL_TRANSPORT = originalEmailTransport;
    vi.clearAllMocks();
  });

  it('inclui o código em desenvolvimento', async () => {
    env.NODE_ENV = 'development';
    env.EMAIL_TRANSPORT = 'resend';

    const body = await requestRegistrationCodeResponse();

    expect(body).toMatchObject({ data: { development_code: '004271' } });
  });

  it('não inclui o código em produção', async () => {
    env.NODE_ENV = 'production';
    env.EMAIL_TRANSPORT = 'json';

    const body = await requestRegistrationCodeResponse();

    expect(body).not.toHaveProperty('data.development_code');
  });

  it('inclui o código em desenvolvimento mesmo com um provider de email ativo', async () => {
    env.NODE_ENV = 'development';
    env.EMAIL_TRANSPORT = 'resend';

    const body = await requestRegistrationCodeResponse();

    expect(body).toMatchObject({ data: { development_code: '004271' } });
  });
});
