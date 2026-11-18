import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
}));

vi.mock('../src/repositories/eventManager.repository', () => ({
  eventManagerRepository: {
    findByEventAndEmailForUpdate: vi.fn(),
    create: vi.fn(),
    reactivate: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findByIdForHost: vi.fn() },
}));

vi.mock('../src/repositories/emailDelivery.repository', () => ({
  emailDeliveryRepository: { enqueue: vi.fn() },
}));

vi.mock('../src/repositories/hostSession.repository', () => ({
  hostSessionRepository: {},
}));

vi.mock('../src/repositories/invitation.repository', () => ({
  invitationRepository: {
    findByEventAndEmail: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../src/repositories/activity.repository', () => ({
  activityRepository: { create: vi.fn() },
}));

vi.mock('../src/services/manageLink.service', () => ({
  generateManageToken: vi.fn(() => ({
    token: 'manage-token',
    hash: 'manage-hash',
    expiresAt: new Date('2027-01-01T00:00:00Z'),
  })),
}));

vi.mock('../src/services/reminder.service', () => ({
  enqueueOnboardingMessages: vi.fn(),
}));

import { activityRepository } from '../src/repositories/activity.repository';
import { eventManagerRepository } from '../src/repositories/eventManager.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { eventManagerService } from '../src/services/eventManager.service';
import { enqueueOnboardingMessages } from '../src/services/reminder.service';
import { EventManager } from '../src/types/eventManager.types';

const hostId = '00000000-0000-4000-8000-000000000010';
const eventId = '00000000-0000-4000-8000-000000000001';
const managerId = '00000000-0000-4000-8000-000000000020';
const invitationId = '00000000-0000-4000-8000-000000000030';

function makeManager(overrides: Partial<EventManager> = {}): EventManager {
  return {
    id: managerId,
    eventId,
    email: 'carlos@exemplo.ao',
    tokenHash: 'manager-token-hash',
    tokenExpiresAt: new Date('2027-01-01T00:00:00Z'),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    hasAccount: false,
    ...overrides,
  };
}

describe('eventManagerService.add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventRepository.findByIdForHost).mockResolvedValue({
      id: eventId,
      hostId,
      hostEmail: 'host@exemplo.ao',
      startsAt: new Date('2027-06-01T18:00:00Z'),
      timezone: 'Africa/Luanda',
      status: 'scheduled',
    } as never);
    vi.mocked(eventManagerRepository.findByEventAndEmailForUpdate).mockResolvedValue(
      null
    );
    vi.mocked(eventManagerRepository.create).mockResolvedValue(makeManager());
    vi.mocked(invitationRepository.findByEventAndEmail).mockResolvedValue(null);
    vi.mocked(invitationRepository.create).mockImplementation(async (data) => ({
      id: invitationId,
      eventId: data.eventId,
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      tableName: data.tableName,
      tokenHash: data.tokenHash,
      tokenEncrypted: data.tokenEncrypted,
      claimHash: null,
      claimedAt: null,
      claimRevokedAt: null,
      rsvpStatus: 'pending',
      rsvpRespondedAt: null,
      rsvpVersion: 0,
      sendStatus: 'pending',
      sendCount: 0,
      lastSentAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }));
  });

  it('inclui automaticamente o gestor na lista de convidados', async () => {
    const result = await eventManagerService.add(
      hostId,
      eventId,
      'CARLOS@Exemplo.ao'
    );

    expect(result.manager).toEqual(makeManager());
    expect(invitationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        guestName: 'Carlos',
        guestEmail: 'carlos@exemplo.ao',
        guestPhone: null,
        tableName: null,
        tokenHash: expect.any(String),
        tokenEncrypted: expect.any(String),
      }),
      expect.anything()
    );
    expect(enqueueOnboardingMessages).toHaveBeenCalledWith(
      expect.objectContaining({ id: eventId }),
      expect.objectContaining({ id: invitationId }),
      expect.anything()
    );
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        invitationId,
        kind: 'guest_added',
        guestName: 'Carlos',
      }),
      expect.anything()
    );
  });

  it('não duplica o convite quando o email já é convidado', async () => {
    vi.mocked(invitationRepository.findByEventAndEmail).mockResolvedValue({
      id: invitationId,
    } as never);

    await eventManagerService.add(hostId, eventId, 'carlos@exemplo.ao');

    expect(invitationRepository.create).not.toHaveBeenCalled();
    expect(enqueueOnboardingMessages).not.toHaveBeenCalled();
  });

  it('rejeita o email do próprio anfitrião', async () => {
    await expect(
      eventManagerService.add(hostId, eventId, 'HOST@exemplo.ao')
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'validation_failed',
    });

    expect(eventManagerRepository.create).not.toHaveBeenCalled();
  });
});
