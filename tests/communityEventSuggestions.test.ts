import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock('../src/repositories/community.repository', () => ({
  communityRepository: {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    findMemberByHost: vi.fn(),
    findMemberById: vi.fn(),
    listMembers: vi.fn(),
    listPendingEventSuggestions: vi.fn(),
    listMyEventSuggestions: vi.fn(),
    createEventSuggestion: vi.fn(),
    findEventSuggestion: vi.fn(),
    decideEventSuggestion: vi.fn(),
    createCommunityActivity: vi.fn(),
    listCommunityActivity: vi.fn(),
    attachHostToInvites: vi.fn(),
  },
}));

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: { findById: vi.fn(), findByIdForUpdate: vi.fn(), countAccepted: vi.fn() },
}));

vi.mock('../src/repositories/host.repository', () => ({
  hostRepository: { findById: vi.fn(async () => null), findByEmail: vi.fn(async () => null) },
}));

vi.mock('../src/repositories/emailDelivery.repository', () => ({
  emailDeliveryRepository: { enqueue: vi.fn(), cancelPendingForEvent: vi.fn() },
}));

vi.mock('../src/services/purposeOtp.service', () => ({
  requestPurposeOtp: vi.fn(async () => ({ expiresAt: new Date(Date.now() + 600_000) })),
  assertPurposeOtp: vi.fn(),
}));

vi.mock('../src/services/event.service', () => ({
  eventService: {
    create: vi.fn(),
    deliverManageLink: vi.fn(async () => 'queued'),
  },
}));

import { communityRepository } from '../src/repositories/community.repository';
import { communityEventSuggestionBodySchema } from '../src/schemas/community.schemas';
import { communityService } from '../src/services/community.service';
import { eventService } from '../src/services/event.service';
import { hostEventService } from '../src/services/hostEvent.service';
import { CommunityEventSuggestion, CommunityMember, CommunityWithStats } from '../src/types/community.types';

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

const memberRow = (hostId: string, role: 'owner' | 'manager' | 'member'): CommunityMember => ({
  id: '00000000-0000-4000-8000-00000000m001',
  communityId: community.id,
  hostId,
  email: `${hostId}@exemplo.ao`,
  phone: null,
  displayName: 'Participante',
  avatarUrl: null,
  role,
  status: 'active',
  refCode: 'abcdef12',
  hasHostAccount: true,
  joinedAt: new Date(),
  createdAt: new Date(),
});

const author = { hostId: 'author-host', email: 'author@exemplo.ao' };
const staff = { hostId: 'owner-host', email: 'owner@exemplo.ao' };
const outsider = { hostId: 'outsider-host', email: 'outsider@exemplo.ao' };

function eventInput() {
  return {
    event: {
      title: 'Encontro da comunidade',
      host_name: 'Autor da sugestão',
      host_email: 'author@exemplo.ao',
      starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      timezone: 'Africa/Luanda',
      location: { type: 'online', online_url: 'https://meet.exemplo.ao/encontro' },
      visibility: 'private',
      // O cliente não decide a comunidade: o serviço substitui pelo id resolvido.
      community_id: '00000000-0000-4000-8000-00000000ffff',
    },
    guests: [{ name: 'Convidado', email: 'convidado@exemplo.ao' }],
    message: 'Sugiro este encontro para a comunidade.',
  };
}

function suggestion(overrides: Partial<CommunityEventSuggestion> = {}): CommunityEventSuggestion {
  const input = eventInput();
  return {
    id: '00000000-0000-4000-8000-00000000s001',
    communityId: community.id,
    hostId: author.hostId,
    email: author.email,
    displayName: 'Autor da sugestão',
    avatarUrl: null,
    title: input.event.title,
    payload: JSON.parse(JSON.stringify({ event: input.event, guests: input.guests })),
    message: input.message,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    eventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(communityRepository.findById).mockResolvedValue(community);
  vi.mocked(communityRepository.listMembers).mockResolvedValue([]);
  vi.mocked(communityRepository.decideEventSuggestion).mockResolvedValue(true);
  vi.mocked(eventService.create).mockResolvedValue({
    event: { id: '00000000-0000-4000-8000-00000000e001' },
    manageEmailStatus: 'pending',
    deliveries: [],
    pendingManageLink: {
      token: 'manage-token',
      idempotencyKey: 'manage_link:00000000-0000-4000-8000-00000000e001',
    },
  });
});

describe('Sugestões de eventos de comunidade', () => {
  it('o corpo aceita mensagem e rejeita campos extra no topo', () => {
    expect(communityEventSuggestionBodySchema.safeParse(eventInput()).success).toBe(true);
    expect(communityEventSuggestionBodySchema.safeParse({ ...eventInput(), extra: 1 }).success).toBe(false);
  });

  it('quem não é membro não sugere', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(null);

    await expect(communityService.suggestEvent(outsider, community.id, eventInput())).rejects.toMatchObject({
      statusCode: 403,
      code: 'community_forbidden',
    });
    expect(communityRepository.createEventSuggestion).not.toHaveBeenCalled();
  });

  it('membro sugere com o community_id resolvido e guarda o payload completo', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow(author.hostId, 'member'));
    vi.mocked(communityRepository.createEventSuggestion).mockImplementation(async (data) =>
      suggestion({
        communityId: data.communityId,
        hostId: data.hostId,
        title: data.title,
        payload: data.payload,
        message: data.message,
      })
    );

    const result = await communityService.suggestEvent(author, community.id, eventInput());

    const call = vi.mocked(communityRepository.createEventSuggestion).mock.calls[0]?.[0];
    expect(call?.communityId).toBe(community.id);
    expect(call?.hostId).toBe(author.hostId);
    expect(call?.payload.event.community_id).toBe(community.id);
    expect(call?.payload.guests).toHaveLength(1);
    expect(call?.message).toBe('Sugiro este encontro para a comunidade.');
    expect(result.status).toBe('pending');
  });

  it('membro não lista sugestões de outros nem decide', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow(author.hostId, 'member'));

    await expect(communityService.listPendingEventSuggestions(author, community.id)).rejects.toMatchObject({
      code: 'community_forbidden',
    });
    await expect(
      communityService.decideEventSuggestion(author, community.id, 's1', true)
    ).rejects.toMatchObject({ code: 'community_forbidden' });
  });

  it('staff lista sugestões pendentes', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow(staff.hostId, 'owner'));
    vi.mocked(communityRepository.listPendingEventSuggestions).mockResolvedValue([suggestion()]);

    await expect(communityService.listPendingEventSuggestions(staff, community.id)).resolves.toHaveLength(1);
  });

  it('aprovar cria o evento com o autor da sugestão como anfitrião e liga o event_id', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow(staff.hostId, 'owner'));
    vi.mocked(communityRepository.findEventSuggestion).mockResolvedValue(suggestion());

    const result = await communityService.decideEventSuggestion(staff, community.id, 's1', true);

    expect(eventService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ community_id: community.id, title: 'Encontro da comunidade' }),
      }),
      expect.objectContaining({ hostId: author.hostId, deferManageLink: true, client: expect.anything() })
    );
    expect(communityRepository.decideEventSuggestion).toHaveBeenCalledWith(
      's1',
      'approved',
      staff.hostId,
      '00000000-0000-4000-8000-00000000e001',
      expect.anything()
    );
    expect(eventService.deliverManageLink).toHaveBeenCalledWith(
      { id: '00000000-0000-4000-8000-00000000e001' },
      expect.objectContaining({ token: 'manage-token' })
    );
    expect(result.status).toBe('approved');
    expect(result.eventId).toBe('00000000-0000-4000-8000-00000000e001');
  });

  it('rejeitar não cria evento', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow(staff.hostId, 'manager'));
    vi.mocked(communityRepository.findEventSuggestion).mockResolvedValue(suggestion());

    const result = await communityService.decideEventSuggestion(staff, community.id, 's1', false);

    expect(eventService.create).not.toHaveBeenCalled();
    expect(communityRepository.decideEventSuggestion).toHaveBeenCalledWith(
      's1',
      'rejected',
      staff.hostId,
      null,
      expect.anything()
    );
    expect(result.status).toBe('rejected');
  });

  it('decisão dupla é rejeitada com conflito', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow(staff.hostId, 'owner'));
    vi.mocked(communityRepository.findEventSuggestion)
      .mockResolvedValueOnce(suggestion())
      .mockResolvedValueOnce(suggestion({ status: 'approved', decidedAt: new Date() }));

    await expect(
      communityService.decideEventSuggestion(staff, community.id, 's1', true)
    ).rejects.toMatchObject({ statusCode: 409, code: 'community_suggestion_decided' });
    expect(eventService.create).not.toHaveBeenCalled();
  });

  it('criação directa de evento de comunidade é bloqueada', async () => {
    await expect(
      hostEventService.create(author.hostId, {
        event: { community_id: community.id },
        guests: [],
      } as never)
    ).rejects.toMatchObject({ statusCode: 422, code: 'community_event_must_be_suggested' });
    expect(eventService.create).not.toHaveBeenCalled();
  });
});
