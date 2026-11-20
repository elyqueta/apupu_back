import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/repositories/eventManager.repository', () => ({
  eventManagerRepository: {
    findByTokenHash: vi.fn(),
    recordAccessFailure: vi.fn(),
    recordSuccessfulAccess: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findById: vi.fn() },
}));

vi.mock('../src/repositories/notification.repository', () => ({
  notificationRepository: { createForHost: vi.fn() },
}));

vi.mock('../src/services/hostSession.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/hostSession.service')>();
  return {
    ...actual,
    hostSessionService: { createManagerSession: vi.fn() },
  };
});

import { notificationRepository } from '../src/repositories/notification.repository';
import { eventManagerRepository } from '../src/repositories/eventManager.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { manageAccessService } from '../src/services/manageAccess.service';
import { hostSessionService } from '../src/services/hostSession.service';
import { EventManager } from '../src/types/eventManager.types';
import { hashAccessCode } from '../src/utils/accessCode.util';
import { hashToken } from '../src/utils/token.util';

const managerId = '00000000-0000-4000-8000-000000000020';
const eventId = '00000000-0000-4000-8000-000000000001';
const token = 'token-com-43-caracteres-base64url-seguros-aqui';
const code = 'ABC234';
const expiresAt = new Date('2027-01-01T00:00:00Z');

function makeManager(overrides: Partial<EventManager> = {}): EventManager {
  return {
    id: managerId,
    eventId,
    teamId: '00000000-0000-4000-8000-000000000021',
    email: 'gestor@exemplo.ao',
    phone: null,
    displayName: 'Gestor',
    tokenHash: hashToken(token),
    tokenExpiresAt: expiresAt,
    accessCodeHash: hashAccessCode(code, managerId),
    accessFailedCount: 0,
    accessLockedUntil: null,
    linkExpiresAt: expiresAt,
    linkRevokedAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    hasAccount: false,
    ...overrides,
  };
}

function sessionResult() {
  return {
    session: { id: 'session', expiresAt },
    sessionToken: 'session-token',
    csrfToken: 'csrf',
    event: { id: eventId, title: 'Evento', hostId: 'host' },
    role: 'manager' as const,
    email: 'gestor@exemplo.ao',
    emailHasAccount: false,
    manageEmailStatus: null,
  };
}

function expectDenied(promise: Promise<unknown>): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    statusCode: 403,
    code: 'access_denied',
    message: 'Não foi possível aceder.',
  });
}

describe('manageAccessService.access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventManagerRepository.findByTokenHash).mockResolvedValue(makeManager());
    vi.mocked(eventManagerRepository.recordAccessFailure).mockResolvedValue({
      failedCount: 1,
      lockedUntil: null,
      revoked: false,
    });
    vi.mocked(hostSessionService.createManagerSession).mockResolvedValue(sessionResult() as never);
    vi.mocked(eventRepository.findById).mockResolvedValue({
      id: eventId,
      title: 'Evento',
      hostId: 'host',
    } as never);
  });

  it('aceita o código correcto e cria a sessão', async () => {
    const result = await manageAccessService.access({ token, code });

    expect(hostSessionService.createManagerSession).toHaveBeenCalled();
    expect(eventManagerRepository.recordSuccessfulAccess).toHaveBeenCalledWith(managerId);
    expect(result).toEqual(sessionResult());
  });

  it('normaliza minúsculas, hífen e espaços', async () => {
    await manageAccessService.access({ token, code: ' abc-234 ' });

    expect(hostSessionService.createManagerSession).toHaveBeenCalled();
  });

  it('devolve a mesma resposta para todos os falhanços', async () => {
    await expectDenied(manageAccessService.access({ token, code: 'ZZZ999' }));

    vi.mocked(eventManagerRepository.findByTokenHash).mockResolvedValue(null);
    await expectDenied(manageAccessService.access({ token, code }));

    vi.mocked(eventManagerRepository.findByTokenHash).mockResolvedValue(
      makeManager({ linkExpiresAt: new Date('2020-01-01T00:00:00Z') })
    );
    await expectDenied(manageAccessService.access({ token, code }));

    vi.mocked(eventManagerRepository.findByTokenHash).mockResolvedValue(
      makeManager({ linkRevokedAt: new Date() })
    );
    await expectDenied(manageAccessService.access({ token, code }));

    vi.mocked(eventManagerRepository.findByTokenHash).mockResolvedValue(
      makeManager({ accessLockedUntil: new Date(Date.now() + 60_000) })
    );
    await expectDenied(manageAccessService.access({ token, code }));

    await expectDenied(manageAccessService.access({ token, code: 'invalido' }));
  });

  it('aceita gestores legados sem código', async () => {
    vi.mocked(eventManagerRepository.findByTokenHash).mockResolvedValue(
      makeManager({ accessCodeHash: null })
    );

    await expect(manageAccessService.access({ token })).resolves.toEqual(sessionResult());
    expect(eventManagerRepository.recordAccessFailure).not.toHaveBeenCalled();
  });

  it('bloqueia o link após 5 falhas', async () => {
    vi.mocked(eventManagerRepository.recordAccessFailure).mockResolvedValue({
      failedCount: 5,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
      revoked: false,
    });

    await expectDenied(manageAccessService.access({ token, code: 'ZZZ999' }));

    expect(eventManagerRepository.recordAccessFailure).toHaveBeenCalledWith(managerId);
    expect(notificationRepository.createForHost).not.toHaveBeenCalled();
  });

  it('revoga o link e notifica o anfitrião após 15 falhas', async () => {
    vi.mocked(eventManagerRepository.recordAccessFailure).mockResolvedValue({
      failedCount: 15,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
      revoked: true,
    });

    await expectDenied(manageAccessService.access({ token, code: 'ZZZ999' }));

    expect(notificationRepository.createForHost).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'host',
        eventId,
        kind: 'access_suspicious',
        title: 'Tentativas de acesso suspeitas ao link de Gestor',
      })
    );
  });
});
