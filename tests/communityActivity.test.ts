import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock('../src/repositories/community.repository', () => ({
  communityRepository: {
    findById: vi.fn(),
    findMemberByHost: vi.fn(),
    listMembers: vi.fn(),
    createCommunityActivity: vi.fn(),
    listCommunityActivity: vi.fn(),
    attachHostToInvites: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findById: vi.fn() },
}));

vi.mock('../src/repositories/host.repository', () => ({
  hostRepository: { findById: vi.fn(async () => null) },
}));

vi.mock('../src/repositories/emailDelivery.repository', () => ({
  emailDeliveryRepository: { enqueue: vi.fn() },
}));

vi.mock('../src/services/purposeOtp.service', () => ({
  requestPurposeOtp: vi.fn(),
  assertPurposeOtp: vi.fn(),
}));

vi.mock('../src/services/event.service', () => ({
  eventService: { create: vi.fn(), deliverManageLink: vi.fn() },
}));

import { toCommunityActivityDto } from '../src/dto/community.dto';
import { communityRepository } from '../src/repositories/community.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { communityService } from '../src/services/community.service';
import { CommunityActivity, CommunityMember, CommunityWithStats } from '../src/types/community.types';

const community: CommunityWithStats = {
  id: '00000000-0000-4000-8000-00000000c001',
  name: 'Comunidade Teste',
  slug: 'comunidade-teste',
  description: null,
  visibility: 'public',
  ownerId: 'owner-host',
  avatarUrl: null,
  coverUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  memberCount: 1,
  eventCount: 0,
  teamCount: 0,
  myRole: 'member',
  myStatus: 'active',
  myPendingRequest: false,
};

const memberRow: CommunityMember = {
  id: '00000000-0000-4000-8000-00000000m001',
  communityId: community.id,
  hostId: 'member-host',
  email: 'membro@exemplo.ao',
  phone: null,
  displayName: 'Membro',
  avatarUrl: null,
  role: 'member',
  status: 'active',
  refCode: 'abcdef12',
  hasHostAccount: true,
  joinedAt: new Date(),
  createdAt: new Date(),
};

const viewer = { hostId: 'member-host', email: 'membro@exemplo.ao' };
const eventId = '00000000-0000-4000-8000-00000000e001';

const activity: CommunityActivity = {
  id: '00000000-0000-4000-8000-00000000a001',
  communityId: community.id,
  hostId: viewer.hostId,
  hostName: 'Membro',
  hostAvatarUrl: null,
  eventId,
  eventTitle: 'Encontro da comunidade',
  eventSlug: 'encontro-da-comunidade',
  createdAt: new Date('2026-11-27T10:00:00.000Z'),
};

const asEvent = (visibility: 'public' | 'private', ownerCommunityId: string | null) =>
  ({ id: eventId, visibility, communityId: ownerCommunityId }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(communityRepository.findById).mockResolvedValue(community);
  vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow);
  vi.mocked(communityRepository.createCommunityActivity).mockResolvedValue({
    activity,
    created: true,
  });
  vi.mocked(communityRepository.listCommunityActivity).mockResolvedValue([activity]);
});

describe('Feed de actividade da comunidade', () => {
  it('quem não é membro activo não partilha nem lista', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(null);

    await expect(communityService.shareActivity(viewer, community.id, eventId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'community_forbidden',
    });
    await expect(communityService.listActivity(viewer, community.id)).rejects.toMatchObject({
      statusCode: 403,
      code: 'community_forbidden',
    });
    expect(communityRepository.createCommunityActivity).not.toHaveBeenCalled();
    expect(communityRepository.listCommunityActivity).not.toHaveBeenCalled();
  });

  it('membro partilha evento público mesmo de outra comunidade', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(
      asEvent('public', '00000000-0000-4000-8000-00000000ffff')
    );

    const result = await communityService.shareActivity(viewer, community.id, eventId);

    expect(communityRepository.createCommunityActivity).toHaveBeenCalledWith({
      communityId: community.id,
      hostId: viewer.hostId,
      eventId,
    });
    expect(result).toEqual({ activity, created: true });
  });

  it('evento privado de outra comunidade é recusado', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(
      asEvent('private', '00000000-0000-4000-8000-00000000ffff')
    );

    await expect(communityService.shareActivity(viewer, community.id, eventId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'community_activity_forbidden',
    });
    expect(communityRepository.createCommunityActivity).not.toHaveBeenCalled();
  });

  it('evento privado da própria comunidade pode ser partilhado', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(asEvent('private', community.id));

    await expect(communityService.shareActivity(viewer, community.id, eventId)).resolves.toEqual({
      activity,
      created: true,
    });
  });

  it('evento inexistente ou apagado dá 404', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(null);

    await expect(communityService.shareActivity(viewer, community.id, eventId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'community_activity_event_not_found',
    });
  });

  it('partilha repetida devolve a entrada existente', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(asEvent('public', community.id));
    vi.mocked(communityRepository.createCommunityActivity).mockResolvedValue({
      activity,
      created: false,
    });

    const result = await communityService.shareActivity(viewer, community.id, eventId);

    expect(result.created).toBe(false);
    expect(result.activity.id).toBe(activity.id);
  });

  it('listagem devolve no máximo 50 entradas e o DTO tem o formato da frontend', async () => {
    await expect(communityService.listActivity(viewer, community.id)).resolves.toEqual([activity]);
    expect(communityRepository.listCommunityActivity).toHaveBeenCalledWith(community.id, 50);
    expect(toCommunityActivityDto(activity)).toEqual({
      id: activity.id,
      community_id: community.id,
      host_id: viewer.hostId,
      host_name: 'Membro',
      host_avatar_url: null,
      event_id: eventId,
      event_title: 'Encontro da comunidade',
      event_slug: 'encontro-da-comunidade',
      created_at: '2026-11-27T10:00:00.000Z',
    });
  });
});
