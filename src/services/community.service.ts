import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { withTransaction } from '../database/pool';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { communityRepository } from '../repositories/community.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { hostRepository } from '../repositories/host.repository';
import {
  CommunityEventSummary,
  CommunityJoinRequest,
  CommunityMember,
  CommunityReferralStat,
  CommunityRole,
  CommunityTeamSummary,
  CommunityTransfer,
  CommunityVisibility,
  CommunityWithStats,
} from '../types/community.types';
import { isUniqueViolation } from '../utils/db.util';
import { normalizeAngolanPhone } from '../utils/phone.util';
import { generateToken } from '../utils/token.util';
import { CommunityActor, communityPermissions } from './communityPermissions';
import { assertPurposeOtp, requestPurposeOtp } from './purposeOtp.service';

/** Mesmo 404 para comunidade inexistente, removida ou privada sem acesso. */
const NOT_FOUND = 'Comunidade não encontrada.';

export interface Viewer {
  hostId: string;
  email: string;
}

export interface CommunityDetail {
  community: CommunityWithStats;
  permissions: Record<string, boolean>;
  myRefCode: string | null;
  events: CommunityEventSummary[];
  teams: CommunityTeamSummary[];
  members: CommunityMember[];
  pendingRequests: number;
  transfer: CommunityTransfer | null;
}

/** Slug a partir do nome: minúsculas, sem acentos, hífenes. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'comunidade';
}

export function newRefCode(): string {
  return generateToken(6);
}

function actorFrom(member: CommunityMember | null): CommunityActor {
  return {
    role: member?.role ?? null,
    status: member?.status ?? null,
    isHostAccount: member?.hasHostAccount ?? false,
  };
}

function deny(message = 'Não tem permissão para esta ação.'): never {
  throw new ForbiddenError(message, 'community_forbidden');
}

async function enqueueNotice(
  data: {
    recipientEmail: string | null;
    kind:
      | 'join_request_received'
      | 'join_request_approved'
      | 'join_request_rejected'
      | 'member_invited'
      | 'transfer_started'
      | 'transfer_completed';
    communityName: string;
    communitySlug: string;
    actorName?: string | null;
    recipientName?: string | null;
  },
  client?: PoolClient
): Promise<void> {
  if (!data.recipientEmail) return;
  await emailDeliveryRepository.enqueue(
    {
      eventId: null,
      invitationId: null,
      hostId: null,
      messageType: 'community_notice',
      reminderKind: null,
      recipientEmail: data.recipientEmail,
      scheduledFor: new Date(),
      idempotencyKey: `community_notice:${data.kind}:${data.communitySlug}:${randomUUID()}`,
      payload: {
        kind: data.kind,
        communityName: data.communityName,
        communitySlug: data.communitySlug,
        ...(data.actorName ? { actorName: data.actorName } : {}),
        ...(data.recipientName ? { recipientName: data.recipientName } : {}),
      },
    },
    client
  );
}

async function displayNameOf(hostId: string): Promise<string | null> {
  const host = await hostRepository.findById(hostId);
  return host?.profile.displayName?.trim() || host?.email || null;
}

export const communityService = {
  /** Papel activo de quem pede (ou `null`). */
  async actor(communityId: string, hostId: string): Promise<{ actor: CommunityActor; member: CommunityMember | null }> {
    const member = await communityRepository.findMemberByHost(communityId, hostId);
    return { actor: actorFrom(member), member };
  },

  async load(viewer: Viewer, idOrSlug: string): Promise<CommunityWithStats> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const community = isUuid
      ? await communityRepository.findById(idOrSlug, viewer.hostId)
      : await communityRepository.findBySlug(idOrSlug, viewer.hostId);
    if (!community) throw new NotFoundError(NOT_FOUND, 'community_not_found');
    // Privada: só membros (activos ou convidados) a encontram.
    if (community.visibility === 'private' && community.myRole === null) {
      throw new NotFoundError(NOT_FOUND, 'community_not_found');
    }
    return community;
  },

  async list(viewer: Viewer, q?: string): Promise<CommunityWithStats[]> {
    await communityRepository.attachHostToInvites(viewer.hostId, viewer.email);
    return communityRepository.listForHost(viewer.hostId, q);
  },

  async discover(viewer: Viewer, q?: string): Promise<CommunityWithStats[]> {
    return communityRepository.listPublic(viewer.hostId, q, 30);
  },

  async detail(viewer: Viewer, idOrSlug: string): Promise<CommunityDetail> {
    await communityRepository.attachHostToInvites(viewer.hostId, viewer.email);
    const community = await this.load(viewer, idOrSlug);
    const { actor, member } = await this.actor(community.id, viewer.hostId);
    const isMember = communityPermissions.canViewMembers(actor);
    const staff = communityPermissions.canDecideJoinRequests(actor);

    const [events, teams, members, requests, transfer] = await Promise.all([
      communityRepository.listEvents(community.id, isMember),
      isMember ? communityRepository.listTeams(community.id) : Promise.resolve([]),
      isMember ? communityRepository.listMembers(community.id) : Promise.resolve([]),
      staff ? communityRepository.listPendingJoinRequests(community.id) : Promise.resolve([]),
      isMember ? communityRepository.findOpenTransfer(community.id) : Promise.resolve(null),
    ]);

    return {
      community,
      permissions: {
        canEdit: communityPermissions.canEditSettings(actor),
        canDelete: communityPermissions.canDeleteCommunity(actor),
        canInvite: communityPermissions.canInviteMembers(actor),
        canDecideRequests: staff,
        canChangeRoles: communityPermissions.canChangeRole(actor),
        canLeave: communityPermissions.canLeave(actor),
        canCreateEvent: communityPermissions.canCreateEvent(actor),
        canCreateTeam: communityPermissions.canCreateTeam(actor),
        canShare: communityPermissions.canShareEvents(actor),
        canViewAllReferrals: communityPermissions.canViewAllReferrals(actor),
        canTransfer: communityPermissions.canStartTransfer(actor),
        canRequestToJoin:
          communityPermissions.canRequestToJoin(actor, community.visibility) &&
          member?.status !== 'invited',
        isMember,
        isInvited: member?.status === 'invited',
      },
      myRefCode: member?.status === 'active' ? member.refCode : null,
      events,
      teams,
      members,
      pendingRequests: requests.length,
      transfer:
        transfer && (transfer.fromHostId === viewer.hostId || transfer.toHostId === viewer.hostId)
          ? transfer
          : null,
    };
  },

  async create(
    viewer: Viewer,
    input: { name: string; description?: string | null; visibility: CommunityVisibility }
  ): Promise<CommunityWithStats> {
    const base = slugify(input.name);
    let slug = base;
    for (let attempt = 0; attempt < 5 && (await communityRepository.slugExists(slug)); attempt += 1) {
      slug = `${base}-${generateToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || attempt}`;
    }
    const created = await withTransaction((client) =>
      communityRepository.create(
        {
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          visibility: input.visibility,
          ownerId: viewer.hostId,
          ownerEmail: viewer.email,
          ownerRefCode: newRefCode(),
        },
        client
      )
    );
    const loaded = await communityRepository.findById(created.id, viewer.hostId);
    if (!loaded) throw new Error('Falha ao ler a comunidade criada.');
    return loaded;
  },

  async update(
    viewer: Viewer,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      visibility?: CommunityVisibility;
      avatar_url?: string | null;
      cover_url?: string | null;
    }
  ): Promise<CommunityWithStats> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canEditSettings(actor)) deny();
    await communityRepository.update(community.id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...('description' in input ? { description: input.description?.trim() || null } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...('avatar_url' in input ? { avatarUrl: input.avatar_url ?? null } : {}),
      ...('cover_url' in input ? { coverUrl: input.cover_url ?? null } : {}),
    });
    const updated = await communityRepository.findById(community.id, viewer.hostId);
    if (!updated) throw new NotFoundError(NOT_FOUND, 'community_not_found');
    return updated;
  },

  async remove(viewer: Viewer, id: string, confirmName: string): Promise<CommunityWithStats> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canDeleteCommunity(actor)) deny();
    if (confirmName.trim() !== community.name.trim()) {
      throw new ValidationError(
        'Escreva o nome da comunidade para confirmar.',
        { confirm_name: ['Escreva o nome da comunidade para confirmar.'] },
        'community_delete_confirmation_required'
      );
    }
    await withTransaction((client) => communityRepository.softDelete(community.id, client));
    return community;
  },

  /* ─────────────────────────────── Membros ─────────────────────────────── */

  async invite(
    viewer: Viewer,
    id: string,
    input: { email?: string; phone?: string; role: Exclude<CommunityRole, 'owner'> }
  ): Promise<CommunityMember> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canInviteMembers(actor)) deny();
    if (input.role === 'manager' && !communityPermissions.canChangeRole(actor)) {
      deny('Só o responsável convida gestores.');
    }
    const email = input.email?.trim().toLowerCase() || null;
    const phone = input.phone?.trim() ? normalizeAngolanPhone(input.phone) : null;
    if (input.phone?.trim() && !phone) {
      throw new ValidationError('Verifique os campos indicados.', {
        phone: ['Indique um telefone angolano válido.'],
      });
    }
    if (!email && !phone) {
      throw new ValidationError('Verifique os campos indicados.', {
        contact: ['Indique um email ou um telefone.'],
      });
    }
    const host = email ? await hostRepository.findByEmail(email) : null;

    try {
      const memberId = await communityRepository.insertMember({
        communityId: community.id,
        hostId: host?.id ?? null,
        email,
        phone,
        displayName: host?.profile.displayName ?? null,
        role: input.role,
        status: 'invited',
        refCode: newRefCode(),
        invitedBy: viewer.hostId,
      });
      await enqueueNotice({
        recipientEmail: email,
        kind: 'member_invited',
        communityName: community.name,
        communitySlug: community.slug,
        actorName: await displayNameOf(viewer.hostId),
        recipientName: host?.profile.displayName ?? null,
      });
      const member = await communityRepository.findMemberById(memberId);
      if (!member) throw new Error('Falha ao ler o membro convidado.');
      return member;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Esta pessoa já é membro ou já foi convidada.', 'community_member_exists');
      }
      throw error;
    }
  },

  /** Aceitar ou recusar um convite recebido. */
  async answerInvite(viewer: Viewer, id: string, accept: boolean): Promise<void> {
    await communityRepository.attachHostToInvites(viewer.hostId, viewer.email);
    const community = await this.load(viewer, id);
    const member = await communityRepository.findMemberByHost(community.id, viewer.hostId);
    if (!member || member.status !== 'invited') {
      throw new NotFoundError('Convite não encontrado.', 'community_invite_not_found');
    }
    await communityRepository.setMemberStatus(member.id, accept ? 'active' : 'left');
  },

  async removeMember(viewer: Viewer, id: string, memberId: string): Promise<CommunityMember> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    const target = await communityRepository.findMemberById(memberId);
    if (!target || target.communityId !== community.id || !['active', 'invited'].includes(target.status)) {
      throw new NotFoundError('Membro não encontrado.', 'community_member_not_found');
    }
    if (!communityPermissions.canRemoveMember(actor, target.role)) deny();
    await communityRepository.setMemberStatus(target.id, 'removed');
    return target;
  },

  async leave(viewer: Viewer, id: string): Promise<void> {
    const community = await this.load(viewer, id);
    const { actor, member } = await this.actor(community.id, viewer.hostId);
    if (!member) throw new NotFoundError(NOT_FOUND, 'community_not_found');
    if (!communityPermissions.canLeave(actor)) {
      throw new ConflictError(
        'Transfira a responsabilidade antes de sair da comunidade.',
        'community_owner_cannot_leave'
      );
    }
    await communityRepository.setMemberStatus(member.id, 'left');
  },

  async changeRole(
    viewer: Viewer,
    id: string,
    memberId: string,
    role: Exclude<CommunityRole, 'owner'>
  ): Promise<CommunityMember> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canChangeRole(actor)) deny();
    const target = await communityRepository.findMemberById(memberId);
    if (!target || target.communityId !== community.id || target.status !== 'active') {
      throw new NotFoundError('Membro não encontrado.', 'community_member_not_found');
    }
    if (target.role === 'owner') {
      throw new ConflictError('Use a transferência para mudar o responsável.', 'community_owner_role');
    }
    await communityRepository.setMemberRole(target.id, role);
    const updated = await communityRepository.findMemberById(target.id);
    if (!updated) throw new NotFoundError('Membro não encontrado.', 'community_member_not_found');
    return updated;
  },

  /* ──────────────────────────── Pedidos de adesão ───────────────────────── */

  async requestToJoin(viewer: Viewer, id: string, message: string | null): Promise<CommunityJoinRequest> {
    const community = await this.load(viewer, id);
    const { actor, member } = await this.actor(community.id, viewer.hostId);
    if (member?.status === 'invited') {
      throw new ConflictError('Já tem um convite para esta comunidade.', 'community_invite_pending');
    }
    if (!communityPermissions.canRequestToJoin(actor, community.visibility)) deny();
    try {
      const request = await communityRepository.createJoinRequest(community.id, viewer.hostId, message);
      const staff = (await communityRepository.listMembers(community.id)).filter(
        (item) => item.status === 'active' && (item.role === 'owner' || item.role === 'manager')
      );
      const actorName = await displayNameOf(viewer.hostId);
      for (const person of staff) {
        await enqueueNotice({
          recipientEmail: person.email,
          kind: 'join_request_received',
          communityName: community.name,
          communitySlug: community.slug,
          actorName,
          recipientName: person.displayName,
        });
      }
      return request;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Já tem um pedido pendente para esta comunidade.', 'community_request_pending');
      }
      throw error;
    }
  },

  async cancelJoinRequest(viewer: Viewer, id: string): Promise<void> {
    const community = await this.load(viewer, id);
    const pending = await communityRepository.listPendingJoinRequests(community.id);
    const mine = pending.find((request) => request.hostId === viewer.hostId);
    if (!mine) throw new NotFoundError('Pedido não encontrado.', 'community_request_not_found');
    await withTransaction((client) =>
      communityRepository.decideJoinRequest(mine.id, 'cancelled', viewer.hostId, client)
    );
  },

  async listJoinRequests(viewer: Viewer, id: string): Promise<CommunityJoinRequest[]> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canDecideJoinRequests(actor)) deny();
    return communityRepository.listPendingJoinRequests(community.id);
  },

  async decideJoinRequest(
    viewer: Viewer,
    id: string,
    requestId: string,
    approve: boolean
  ): Promise<CommunityJoinRequest> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canDecideJoinRequests(actor)) deny();

    const request = await communityRepository.findJoinRequest(requestId);
    if (!request || request.communityId !== community.id || request.status !== 'pending') {
      throw new NotFoundError('Pedido não encontrado.', 'community_request_not_found');
    }

    await withTransaction(async (client) => {
      const decided = await communityRepository.decideJoinRequest(
        request.id,
        approve ? 'approved' : 'rejected',
        viewer.hostId,
        client
      );
      if (!decided) throw new ConflictError('O pedido já foi decidido.', 'community_request_decided');
      if (approve) {
        const existing = await communityRepository.findMemberByHost(community.id, request.hostId, client);
        if (existing) {
          await communityRepository.setMemberStatus(existing.id, 'active', client);
        } else {
          await communityRepository.insertMember(
            {
              communityId: community.id,
              hostId: request.hostId,
              email: request.email,
              phone: null,
              displayName: request.displayName,
              role: 'member',
              status: 'active',
              refCode: newRefCode(),
              invitedBy: viewer.hostId,
            },
            client
          );
        }
      }
      await enqueueNotice(
        {
          recipientEmail: request.email,
          kind: approve ? 'join_request_approved' : 'join_request_rejected',
          communityName: community.name,
          communitySlug: community.slug,
          recipientName: request.displayName,
        },
        client
      );
    });

    return { ...request, status: approve ? 'approved' : 'rejected', decidedBy: viewer.hostId };
  },

  /* ─────────────────────── Transferência de responsabilidade ─────────────── */

  /** Passo 0: o responsável escolhe o destinatário e recebe um OTP por email. */
  async startTransfer(viewer: Viewer, id: string, toMemberId: string): Promise<CommunityTransfer> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canStartTransfer(actor)) deny();

    const target = await communityRepository.findMemberById(toMemberId);
    if (!target || target.communityId !== community.id || !target.hostId) {
      throw new NotFoundError('Membro não encontrado.', 'community_member_not_found');
    }
    if (!communityPermissions.canReceiveTransfer(actorFrom(target))) {
      throw new ConflictError(
        'O destinatário tem de ser gestor ou membro ativo com conta de anfitrião.',
        'community_transfer_target_invalid'
      );
    }

    return withTransaction(async (client) => {
      const { expiresAt } = await requestPurposeOtp(
        viewer.email,
        'community_transfer',
        { communityName: community.name },
        client
      );
      return communityRepository.createTransfer(
        {
          communityId: community.id,
          fromHostId: viewer.hostId,
          toHostId: target.hostId as string,
          otpExpiresAt: expiresAt,
        },
        client
      );
    });
  },

  /** Passo 1: o responsável confirma com o OTP; o destinatário é avisado. */
  async verifyTransferOtp(viewer: Viewer, id: string, code: string): Promise<CommunityTransfer> {
    const community = await this.load(viewer, id);
    const transfer = await communityRepository.findOpenTransfer(community.id);
    if (!transfer || transfer.fromHostId !== viewer.hostId || transfer.status !== 'pending_otp') {
      throw new NotFoundError('Transferência não encontrada.', 'community_transfer_not_found');
    }
    await assertPurposeOtp(viewer.email, 'community_transfer', code);

    const target = await hostRepository.findById(transfer.toHostId);
    await withTransaction(async (client) => {
      await communityRepository.setTransferStatus(transfer.id, 'pending_accept', client);
      await enqueueNotice(
        {
          recipientEmail: target?.email ?? null,
          kind: 'transfer_started',
          communityName: community.name,
          communitySlug: community.slug,
          actorName: await displayNameOf(viewer.hostId),
          recipientName: target?.profile.displayName ?? null,
        },
        client
      );
    });
    return { ...transfer, status: 'pending_accept' };
  },

  /** Passo 2: o destinatário aceita; troca atómica de papéis. */
  async acceptTransfer(viewer: Viewer, id: string): Promise<CommunityTransfer> {
    const community = await this.load(viewer, id);
    return withTransaction(async (client) => {
      const transfer = await communityRepository.findOpenTransfer(community.id, client);
      if (!transfer || transfer.toHostId !== viewer.hostId || transfer.status !== 'pending_accept') {
        throw new NotFoundError('Transferência não encontrada.', 'community_transfer_not_found');
      }
      const target = await communityRepository.findMemberByHost(community.id, viewer.hostId, client);
      if (!communityPermissions.canReceiveTransfer(actorFrom(target))) {
        throw new ConflictError(
          'Já não pode receber a responsabilidade desta comunidade.',
          'community_transfer_target_invalid'
        );
      }
      await communityRepository.swapOwner(community.id, transfer.fromHostId, transfer.toHostId, client);
      await communityRepository.setTransferStatus(transfer.id, 'completed', client);
      const previous = await hostRepository.findById(transfer.fromHostId);
      await enqueueNotice(
        {
          recipientEmail: previous?.email ?? null,
          kind: 'transfer_completed',
          communityName: community.name,
          communitySlug: community.slug,
          recipientName: previous?.profile.displayName ?? null,
        },
        client
      );
      return { ...transfer, status: 'completed', completedAt: new Date() };
    });
  },

  async cancelTransfer(viewer: Viewer, id: string): Promise<void> {
    const community = await this.load(viewer, id);
    await withTransaction(async (client) => {
      const transfer = await communityRepository.findOpenTransfer(community.id, client);
      if (!transfer || (transfer.fromHostId !== viewer.hostId && transfer.toHostId !== viewer.hostId)) {
        throw new NotFoundError('Transferência não encontrada.', 'community_transfer_not_found');
      }
      await communityRepository.setTransferStatus(transfer.id, 'cancelled', client);
    });
  },

  /* ─────────────────────────────── Partilhas ────────────────────────────── */

  async referrals(viewer: Viewer, id: string): Promise<CommunityReferralStat[]> {
    const community = await this.load(viewer, id);
    const { actor, member } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canShareEvents(actor) || !member) deny();
    return communityRepository.referralStats(
      community.id,
      communityPermissions.canViewAllReferrals(actor) ? undefined : member.id
    );
  },
};
