import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
}));

vi.mock('../src/repositories/eventManager.repository', () => ({
  eventManagerRepository: {
    findByEventAndEmailForUpdate: vi.fn(),
    create: vi.fn(),
    reactivate: vi.fn(),
    updateAccessCodeHash: vi.fn(),
    findActiveById: vi.fn(),
    rotateToken: vi.fn(),
    updateLinkValidity: vi.fn(),
    revokeLink: vi.fn(),
    findById: vi.fn(),
    revoke: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findByIdForHost: vi.fn() },
}));

vi.mock('../src/repositories/emailDelivery.repository', () => ({
  emailDeliveryRepository: { enqueue: vi.fn() },
}));

vi.mock('../src/repositories/hostSession.repository', () => ({
  hostSessionRepository: { revokeAllForManager: vi.fn() },
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

vi.mock('../src/repositories/team.repository', () => ({
  teamRepository: { create: vi.fn() },
}));

vi.mock('../src/services/manageLink.service', () => ({
  generateManageToken: vi.fn(() => ({
    token: 'manage-token',
    hash: 'manage-hash',
    expiresAt: new Date('2027-01-01T00:00:00Z'),
  })),
}));

vi.mock('../src/services/linkValidity.service', () => ({
  linkValidityService: {
    resolve: vi.fn(async () => new Date('2027-01-01T00:00:00Z')),
  },
}));

vi.mock('../src/services/reminder.service', () => ({
  enqueueOnboardingMessages: vi.fn(),
}));

import { activityRepository } from '../src/repositories/activity.repository';
import { emailDeliveryRepository } from '../src/repositories/emailDelivery.repository';
import { eventManagerRepository } from '../src/repositories/eventManager.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { invitationRepository } from '../src/repositories/invitation.repository';
import { teamRepository } from '../src/repositories/team.repository';
import { eventManagerService } from '../src/services/eventManager.service';
import { enqueueOnboardingMessages } from '../src/services/reminder.service';
import { EventManager } from '../src/types/eventManager.types';
import { TeamWithStats } from '../src/types/team.types';

const hostId = '00000000-0000-4000-8000-000000000010';
const eventId = '00000000-0000-4000-8000-000000000001';
const managerId = '00000000-0000-4000-8000-000000000020';
const teamId = '00000000-0000-4000-8000-000000000021';
const invitationId = '00000000-0000-4000-8000-000000000030';
const expiresAt = new Date('2027-01-01T00:00:00Z');

function makeManager(overrides: Partial<EventManager> = {}): EventManager {
  return {
    id: managerId,
    eventId,
    teamId,
    email: 'carlos@exemplo.ao',
    phone: null,
    displayName: 'Carlos',
    tokenHash: 'manager-token-hash',
    tokenExpiresAt: expiresAt,
    accessCodeHash: 'access-code-hash',
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

function makeTeam(): TeamWithStats {
  return {
    id: teamId,
    eventId,
    name: 'Equipa do Carlos',
    category: 'outra',
    description: null,
    createdByHostId: hostId,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    eventTitle: 'Evento',
    eventStatus: 'agendado',
    memberCount: 0,
    taskCount: 0,
    completedTaskCount: 0,
    openTaskCount: 0,
    membersPreview: [],
  } as TeamWithStats;
}

const addInput = {
  team_name: 'Equipa do Carlos',
  display_name: 'Carlos',
  email: 'CARLOS@Exemplo.ao',
  phone: null,
  link_expires_at: null,
};

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
    vi.mocked(eventManagerRepository.findByEventAndEmailForUpdate).mockResolvedValue(null);
    vi.mocked(eventManagerRepository.create).mockResolvedValue(makeManager());
    vi.mocked(teamRepository.create).mockResolvedValue(makeTeam());
    vi.mocked(invitationRepository.findByEventAndEmail).mockResolvedValue(null);
    vi.mocked(invitationRepository.create).mockImplementation(async (data) => ({
      id: invitationId,
      eventId: data.eventId,
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      tableName: data.tableName,
      guestMessage: null,
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

  it('cria equipa + gestor e inclui o gestor na lista de convidados', async () => {
    const result = await eventManagerService.add(hostId, eventId, addInput);

    expect(result.manager).toEqual(makeManager());
    expect(result.team).toEqual(makeTeam());
    expect(result.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(result.link).toContain('/gerir/manage-token');
    expect(teamRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, name: 'Equipa do Carlos' }),
      expect.anything()
    );
    expect(eventManagerRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        teamId,
        email: 'carlos@exemplo.ao',
        phone: null,
      }),
      expect.anything()
    );
    expect(emailDeliveryRepository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'manager_invite',
        payload: { access_code: expect.stringMatching(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/) },
      })
    );
    expect(invitationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        guestName: 'Carlos',
        guestEmail: 'carlos@exemplo.ao',
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

    await eventManagerService.add(hostId, eventId, addInput);

    expect(invitationRepository.create).not.toHaveBeenCalled();
    expect(enqueueOnboardingMessages).not.toHaveBeenCalled();
  });

  it('rejeita o email do próprio anfitrião', async () => {
    await expect(
      eventManagerService.add(hostId, eventId, {
        ...addInput,
        email: 'HOST@exemplo.ao',
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'validation_failed',
    });

    expect(eventManagerRepository.create).not.toHaveBeenCalled();
  });

  it('normaliza telefone angolano e não envia email para contacto só por telefone', async () => {
    vi.mocked(eventManagerRepository.create).mockResolvedValue(
      makeManager({ email: null, phone: '+244923456789' })
    );

    const result = await eventManagerService.add(hostId, eventId, {
      team_name: 'Equipa do Telefone',
      display_name: null,
      email: null,
      phone: '923 456 789',
      link_expires_at: null,
    });

    expect(eventManagerRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: null, phone: '+244923456789' }),
      expect.anything()
    );
    expect(result.status).toBe('not_sent');
    expect(emailDeliveryRepository.enqueue).not.toHaveBeenCalled();
  });
});
