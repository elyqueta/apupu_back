import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock('../src/repositories/host.repository', () => ({
  hostRepository: { emailExists: vi.fn() },
}));

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: { findLatestGuestNameByEmail: vi.fn() },
}));

vi.mock('../src/repositories/registrationVerification.repository', () => ({
  registrationVerificationRepository: {
    findLatestActiveForEmail: vi.fn(),
    consumePendingForEmail: vi.fn(),
    createVerified: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: {},
}));

vi.mock('../src/repositories/hostAuthSession.repository', () => ({
  hostAuthSessionRepository: {},
}));

vi.mock('../src/repositories/hostToken.repository', () => ({
  emailVerificationRepository: {},
  passwordResetRepository: {},
}));

vi.mock('../src/services/audit.service', () => ({
  auditService: { record: vi.fn() },
}));

vi.mock('../src/services/reminder.service', () => ({
  enqueueEmailVerification: vi.fn(),
  enqueueHostWelcome: vi.fn(),
  enqueuePasswordReset: vi.fn(),
  enqueueRegistrationOtp: vi.fn(),
}));

import { authService } from '../src/services/auth.service';
import { hostRepository } from '../src/repositories/host.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { registrationVerificationRepository } from '../src/repositories/registrationVerification.repository';
import { enqueueRegistrationOtp } from '../src/services/reminder.service';

describe('registo com email inscrito por um anfitrião', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hostRepository.emailExists).mockResolvedValue(false);
  });

  it('dispensa o OTP e devolve o nome do convite com token de registo', async () => {
    vi.mocked(invitationRepository.findLatestGuestNameByEmail).mockResolvedValue('Ana Silva');

    const result = await authService.requestRegistrationCode({ email: 'ana@exemplo.ao' });

    expect(result.status).toBe('guest');
    if (result.status !== 'guest') throw new Error('Esperava o fluxo de convidado.');

    expect(result.displayName).toBe('Ana Silva');
    expect(result.verificationToken).toEqual(expect.any(String));
    expect(result.verificationToken.length).toBeGreaterThan(20);
    expect(registrationVerificationRepository.createVerified).toHaveBeenCalledWith(
      'ana@exemplo.ao',
      expect.any(String),
      expect.any(Date),
      expect.anything()
    );
    expect(registrationVerificationRepository.create).not.toHaveBeenCalled();
    expect(enqueueRegistrationOtp).not.toHaveBeenCalled();
  });

  it('mantém o OTP quando o email não está em nenhum convite', async () => {
    vi.mocked(invitationRepository.findLatestGuestNameByEmail).mockResolvedValue(null);
    vi.mocked(registrationVerificationRepository.findLatestActiveForEmail).mockResolvedValue(
      null
    );
    vi.mocked(registrationVerificationRepository.create).mockResolvedValue(
      {} as never
    );

    const result = await authService.requestRegistrationCode({ email: 'nova@exemplo.ao' });

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('Esperava o fluxo por OTP.');

    expect(result.code).toMatch(/^\d{6}$/);
    expect(registrationVerificationRepository.createVerified).not.toHaveBeenCalled();
    expect(enqueueRegistrationOtp).toHaveBeenCalledWith(
      'nova@exemplo.ao',
      result.code,
      expect.anything()
    );
  });
});
