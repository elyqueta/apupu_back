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
    createTransfer: vi.fn(async (data: Record<string, unknown>) => ({ ...data, id: 't1', status: 'pending_otp' })),
    findOpenTransfer: vi.fn(),
    setTransferStatus: vi.fn(),
    swapOwner: vi.fn(),
    setMemberStatus: vi.fn(),
    attachHostToInvites: vi.fn(),
  },
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

vi.mock('../src/repositories/event.repository', () => ({
  eventRepository: {
    findById: vi.fn(),
    countAccepted: vi.fn(async () => 0),
    softDelete: vi.fn(async () => true),
  },
}));

import { communityRepository } from '../src/repositories/community.repository';
import { eventRepository } from '../src/repositories/event.repository';
import { CommunityActor, communityPermissions } from '../src/services/communityPermissions';
import { communityService, slugify } from '../src/services/community.service';
import { hostEventService } from '../src/services/hostEvent.service';
import { assertPurposeOtp, requestPurposeOtp } from '../src/services/purposeOtp.service';
import { CommunityMember, CommunityRole, CommunityWithStats } from '../src/types/community.types';

const actor = (role: CommunityRole | null, status: 'active' | 'invited' | null = 'active'): CommunityActor => ({
  role,
  status: role ? status : null,
  isHostAccount: true,
});

const owner = actor('owner');
const manager = actor('manager');
const member = actor('member');
const outsider = actor(null);
const invited = actor('member', 'invited');

const community: CommunityWithStats = {
  id: '00000000-0000-4000-8000-00000000c001',
  name: 'Ministério dos Adolescentes',
  slug: 'ministerio-dos-adolescentes',
  description: null,
  visibility: 'public',
  ownerId: 'owner-host',
  avatarUrl: null,
  coverUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  memberCount: 3,
  eventCount: 1,
  teamCount: 0,
  myRole: 'owner',
  myStatus: 'active',
  myPendingRequest: false,
};

function memberRow(overrides: Partial<CommunityMember>): CommunityMember {
  return {
    id: '00000000-0000-4000-8000-00000000m001',
    communityId: community.id,
    hostId: 'target-host',
    email: 'alvo@exemplo.ao',
    phone: null,
    displayName: 'Alvo',
    avatarUrl: null,
    role: 'member',
    status: 'active',
    refCode: 'abcdef12',
    hasHostAccount: true,
    joinedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

const viewer = { hostId: 'owner-host', email: 'dono@exemplo.ao' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(communityRepository.findById).mockResolvedValue(community);
});

describe('Bloco 11 — permissões por papel', () => {
  it('definições e convites: só gestores e responsável', () => {
    for (const fn of [communityPermissions.canEditSettings, communityPermissions.canInviteMembers, communityPermissions.canDecideJoinRequests]) {
      expect(fn(owner)).toBe(true);
      expect(fn(manager)).toBe(true);
      expect(fn(member)).toBe(false);
      expect(fn(outsider)).toBe(false);
      expect(fn(invited)).toBe(false);
    }
  });

  it('apagar comunidade e mudar papéis: só o responsável', () => {
    expect(communityPermissions.canDeleteCommunity(owner)).toBe(true);
    expect(communityPermissions.canDeleteCommunity(manager)).toBe(false);
    expect(communityPermissions.canChangeRole(manager)).toBe(false);
    expect(communityPermissions.canChangeRole(member)).toBe(false);
  });

  it('remover: gestores removem membros; só o responsável remove gestores; ninguém remove o responsável', () => {
    expect(communityPermissions.canRemoveMember(manager, 'member')).toBe(true);
    expect(communityPermissions.canRemoveMember(manager, 'manager')).toBe(false);
    expect(communityPermissions.canRemoveMember(owner, 'manager')).toBe(true);
    expect(communityPermissions.canRemoveMember(owner, 'owner')).toBe(false);
    expect(communityPermissions.canRemoveMember(member, 'member')).toBe(false);
  });

  it('sair: membros e gestores saem; o responsável não', () => {
    expect(communityPermissions.canLeave(member)).toBe(true);
    expect(communityPermissions.canLeave(manager)).toBe(true);
    expect(communityPermissions.canLeave(owner)).toBe(false);
  });

  it('eventos: só o responsável apaga com confirmados', () => {
    expect(communityPermissions.canDeleteEvent(owner, 3)).toBe(true);
    expect(communityPermissions.canDeleteEvent(manager, 3)).toBe(false);
    expect(communityPermissions.canDeleteEvent(manager, 0)).toBe(true);
    expect(communityPermissions.canDeleteEvent(member, 0)).toBe(false);
    expect(communityPermissions.canCreateEvent(member)).toBe(false);
    expect(communityPermissions.canCreateEvent(manager)).toBe(true);
  });

  it('partilha: membros activos partilham; só staff vê todas as estatísticas', () => {
    expect(communityPermissions.canShareEvents(member)).toBe(true);
    expect(communityPermissions.canShareEvents(outsider)).toBe(false);
    expect(communityPermissions.canViewAllReferrals(member)).toBe(false);
    expect(communityPermissions.canViewAllReferrals(manager)).toBe(true);
  });

  it('pedir adesão: só a comunidades públicas e quem não é membro', () => {
    expect(communityPermissions.canRequestToJoin(outsider, 'public')).toBe(true);
    expect(communityPermissions.canRequestToJoin(outsider, 'private')).toBe(false);
    expect(communityPermissions.canRequestToJoin(member, 'public')).toBe(false);
  });

  it('transferência: destinatário tem de ser gestor/membro activo com conta', () => {
    expect(communityPermissions.canStartTransfer(owner)).toBe(true);
    expect(communityPermissions.canStartTransfer(manager)).toBe(false);
    expect(communityPermissions.canReceiveTransfer(member)).toBe(true);
    expect(communityPermissions.canReceiveTransfer({ ...member, isHostAccount: false })).toBe(false);
    expect(communityPermissions.canReceiveTransfer(invited)).toBe(false);
  });
});

describe('Bloco 11 — comunidades', () => {
  it('slug sem acentos nem espaços', () => {
    expect(slugify('Ministério dos Adolescentes!')).toBe('ministerio-dos-adolescentes');
    expect(slugify('***')).toBe('comunidade');
  });

  it('comunidade privada é 404 para quem não é membro', async () => {
    vi.mocked(communityRepository.findById).mockResolvedValue({
      ...community,
      visibility: 'private',
      myRole: null,
      myStatus: null,
    });
    await expect(communityService.load(viewer, community.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('transferência: só o responsável inicia, com OTP por email', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({ hostId: viewer.hostId, role: 'owner' }));
    vi.mocked(communityRepository.findMemberById).mockResolvedValue(memberRow({}));
    await communityService.startTransfer(viewer, community.id, '00000000-0000-4000-8000-00000000m001');
    expect(requestPurposeOtp).toHaveBeenCalledWith(viewer.email, 'community_transfer', expect.any(Object), expect.anything());

    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({ hostId: viewer.hostId, role: 'manager' }));
    await expect(
      communityService.startTransfer(viewer, community.id, '00000000-0000-4000-8000-00000000m001')
    ).rejects.toMatchObject({ code: 'community_forbidden' });
  });

  it('transferência: destinatário sem conta de anfitrião é recusado', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({ hostId: viewer.hostId, role: 'owner' }));
    vi.mocked(communityRepository.findMemberById).mockResolvedValue(memberRow({ hasHostAccount: false }));
    await expect(
      communityService.startTransfer(viewer, community.id, '00000000-0000-4000-8000-00000000m001')
    ).rejects.toMatchObject({ code: 'community_transfer_target_invalid' });
  });

  it('transferência: sem OTP válido não avança; aceitação troca os papéis', async () => {
    vi.mocked(communityRepository.findOpenTransfer).mockResolvedValue({
      id: 't1',
      communityId: community.id,
      fromHostId: viewer.hostId,
      toHostId: 'target-host',
      status: 'pending_otp',
      otpExpiresAt: new Date(),
      createdAt: new Date(),
      completedAt: null,
    });
    vi.mocked(assertPurposeOtp).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'otp_invalid' }));
    await expect(communityService.verifyTransferOtp(viewer, community.id, '000000')).rejects.toMatchObject({
      code: 'otp_invalid',
    });
    expect(communityRepository.setTransferStatus).not.toHaveBeenCalled();

    vi.mocked(communityRepository.findOpenTransfer).mockResolvedValue({
      id: 't1',
      communityId: community.id,
      fromHostId: viewer.hostId,
      toHostId: 'target-host',
      status: 'pending_accept',
      otpExpiresAt: new Date(),
      createdAt: new Date(),
      completedAt: null,
    });
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({}));
    await communityService.acceptTransfer({ hostId: 'target-host', email: 'alvo@exemplo.ao' }, community.id);
    expect(communityRepository.swapOwner).toHaveBeenCalledWith(community.id, viewer.hostId, 'target-host', expect.anything());
  });

  it('o responsável não sai sem transferir', async () => {
    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({ hostId: viewer.hostId, role: 'owner' }));
    await expect(communityService.leave(viewer, community.id)).rejects.toMatchObject({
      code: 'community_owner_cannot_leave',
    });
  });
});

describe('Bloco 11 — apagar evento da comunidade', () => {
  const event = {
    id: 'ev1',
    hostId: 'manager-host',
    title: 'Retiro',
    communityId: community.id,
  };

  it('gestor (mesmo criador) não apaga evento com confirmados; responsável apaga', async () => {
    vi.mocked(eventRepository.findById).mockResolvedValue(event as never);
    vi.mocked(eventRepository.countAccepted).mockResolvedValue(2);

    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({ hostId: 'manager-host', role: 'manager' }));
    await expect(hostEventService.remove('manager-host', 'ev1', 'Retiro')).rejects.toMatchObject({
      code: 'community_forbidden',
    });

    vi.mocked(communityRepository.findMemberByHost).mockResolvedValue(memberRow({ hostId: 'owner-host', role: 'owner' }));
    await expect(hostEventService.remove('owner-host', 'ev1', 'Retiro')).resolves.toEqual({ acceptedCount: 2 });
  });
});

describe('Sessão persistente de quem entra com link + código', () => {
  it('dura até ao fim do link, com mínimo de uma sessão normal', async () => {
    const { managerSessionExpiry } = await import('../src/services/hostSession.service');
    const now = Date.UTC(2026, 10, 24);
    const link = new Date(now + 10 * 86_400_000);
    expect(managerSessionExpiry({ linkExpiresAt: link, tokenExpiresAt: null }, now).getTime()).toBe(link.getTime());
    const soon = new Date(now + 60_000);
    expect(managerSessionExpiry({ linkExpiresAt: soon, tokenExpiresAt: null }, now).getTime()).toBeGreaterThan(soon.getTime());
    expect(managerSessionExpiry({ linkExpiresAt: null, tokenExpiresAt: null }, now).getTime()).toBe(now + 30 * 86_400_000);
  });
});
