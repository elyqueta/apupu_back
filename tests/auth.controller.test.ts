import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/auth.service', () => ({
  authService: { requestRegistrationCode: vi.fn() },
}));

import { authController } from '../src/controllers/auth.controller';
import { authService } from '../src/services/auth.service';

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
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('nunca inclui o código OTP na resposta', async () => {
    const body = await requestRegistrationCodeResponse();

    expect(body).not.toHaveProperty('data.development_code');
    expect(body).not.toHaveProperty('data.code');
  });
});
