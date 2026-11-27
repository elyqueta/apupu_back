import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { communityRepository } from '../repositories/community.repository';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { eventRepository } from '../repositories/event.repository';
import { hostRepository } from '../repositories/host.repository';
import { createEventSchema } from '../schemas/event.schemas';
import {
  CommunityActivity,
  CommunityEventSuggestion,
  CommunityEventSummary,
  CommunityJoinRequest,
  CommunityMember,
  CommunityReferralStat,
  CommunityRole,
  CommunityTeamSummary,
  CommunityTransfer,
  CommunityVisibility,
  CommunityWithStats,
  EventSuggestionStatus,
} from '../types/community.types';
import { isUniqueViolation } from '../utils/db.util';
import { normalizeAngolanPhone } from '../utils/phone.util';
import { generateToken } from '../utils/token.util';
import { destroyImage, uploadImage } from './cloudinary.service';
import { CommunityActor, communityPermissions } from './communityPermissions';
import { CreatedEventResult, eventService } from './event.service';
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
  pendingEventSuggestions: number;
  transfer: CommunityTransfer | null;
}

/** Corpo aceite na sugestão: o evento é validado por `createEventSchema`. */
export interface EventSuggestionInput {
  event: Record<string, unknown>;
  guests?: unknown[];
  message?: string | null;
}

function zodFields(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
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

type CommunityImageKind = 'avatar' | 'cover';

interface StoredImage {
  url: string | null;
  publicId: string | null;
}

/** Só responsável e gestores activos alteram a identidade visual. */
async function requireEditor(viewer: Viewer, idOrSlug: string): Promise<CommunityWithStats> {
  const community = await communityService.load(viewer, idOrSlug);
  const { actor } = await communityService.actor(community.id, viewer.hostId);
  if (!communityPermissions.canEditSettings(actor)) deny();
  return community;
}

async function applyImage(
  viewer: Viewer,
  community: CommunityWithStats,
  kind: CommunityImageKind,
  image: StoredImage
): Promise<CommunityWithStats> {
  const previousPublicId =
    kind === 'avatar' ? community.avatarPublicId : community.coverPublicId;

  await communityRepository.update(
    community.id,
    kind === 'avatar'
      ? { avatarUrl: image.url, avatarPublicId: image.publicId }
      : { coverUrl: image.url, coverPublicId: image.publicId }
  );

  if (previousPublicId && previousPublicId !== image.publicId) {
    await destroyImage(previousPublicId);
  }

  const updated = await communityRepository.findById(community.id, viewer.hostId);
  if (!updated) throw new NotFoundError(NOT_FOUND, 'community_not_found');
  return updated;
}

function uploadOptions() {
  return {
    folder: env.CLOUDINARY_COMMUNITY_FOLDER,
    unavailableMessage: 'O upload da imagem da comunidade não está configurado.',
    unavailableCode: 'community_image_upload_unavailable',
  };
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
      | 'transfer_completed'
      | 'event_suggestion_received'
      | 'event_suggestion_approved'
      | 'event_suggestion_rejected';
    communityName: string;
    communitySlug: string;
    actorName?: string | null;
    recipientName?: string | null;
    /** Identificador do destinatário, para chaves idempotentes estáveis. */
    recipientHostId?: string | null;
    /** Identifica a sugestão num aviso: uma chave por destinatário/sugestão. */
    referenceId?: string;
    eventTitle?: string | null;
  },
  client?: PoolClient
): Promise<void> {
  if (!data.recipientEmail) return;
  const idempotencyKey = data.referenceId
    ? `community_notice:${data.kind}:${data.recipientHostId ?? data.recipientEmail}:${data.referenceId}`
    : `community_notice:${data.kind}:${data.communitySlug}:${randomUUID()}`;
  await emailDeliveryRepository.enqueue(
    {
      eventId: null,
      invitationId: null,
      hostId: null,
      messageType: 'community_notice',
      reminderKind: null,
      recipientEmail: data.recipientEmail,
      scheduledFor: new Date(),
      idempotencyKey,
      payload: {
        kind: data.kind,
        communityName: data.communityName,
        communitySlug: data.communitySlug,
        ...(data.actorName ? { actorName: data.actorName } : {}),
        ...(data.recipientName ? { recipientName: data.recipientName } : {}),
        ...(data.eventTitle ? { eventTitle: data.eventTitle } : {}),
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

    const [events, teams, members, requests, suggestions, transfer] = await Promise.all([
      communityRepository.listEvents(community.id, isMember),
      isMember ? communityRepository.listTeams(community.id) : Promise.resolve([]),
      isMember ? communityRepository.listMembers(community.id) : Promise.resolve([]),
      staff ? communityRepository.listPendingJoinRequests(community.id) : Promise.resolve([]),
      staff ? communityRepository.listPendingEventSuggestions(community.id) : Promise.resolve([]),
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
        canSuggestEvent: communityPermissions.canSuggestEvent(actor),
        canDecideEventSuggestions: staff,
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
      pendingEventSuggestions: suggestions.length,
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
      ...('avatar_url' in input
        ? { avatarUrl: input.avatar_url ?? null, avatarPublicId: null }
        : {}),
      ...('cover_url' in input
        ? { coverUrl: input.cover_url ?? null, coverPublicId: null }
        : {}),
    });

    if ('avatar_url' in input && community.avatarPublicId) {
      await destroyImage(community.avatarPublicId);
    }
    if ('cover_url' in input && community.coverPublicId) {
      await destroyImage(community.coverPublicId);
    }

    const updated = await communityRepository.findById(community.id, viewer.hostId);
    if (!updated) throw new NotFoundError(NOT_FOUND, 'community_not_found');
    return updated;
  },

  async setAvatarFromUrl(viewer: Viewer, id: string, url: string): Promise<CommunityWithStats> {
    const community = await requireEditor(viewer, id);
    if (community.avatarUrl === url && !community.avatarPublicId) return community;
    return applyImage(viewer, community, 'avatar', { url, publicId: null });
  },

  /** Envia o ficheiro para o Cloudinary e guarda URL + public_id. */
  async uploadAvatar(
    viewer: Viewer,
    id: string,
    buffer: Buffer,
    contentType: string
  ): Promise<CommunityWithStats> {
    const community = await requireEditor(viewer, id);
    const uploaded = await uploadImage(buffer, contentType, uploadOptions());
    return applyImage(viewer, community, 'avatar', uploaded);
  },

  async removeAvatar(viewer: Viewer, id: string): Promise<CommunityWithStats> {
    const community = await requireEditor(viewer, id);
    if (!community.avatarUrl && !community.avatarPublicId) return community;
    return applyImage(viewer, community, 'avatar', { url: null, publicId: null });
  },

  async setCoverFromUrl(viewer: Viewer, id: string, url: string): Promise<CommunityWithStats> {
    const community = await requireEditor(viewer, id);
    if (community.coverUrl === url && !community.coverPublicId) return community;
    return applyImage(viewer, community, 'cover', { url, publicId: null });
  },

  async uploadCover(
    viewer: Viewer,
    id: string,
    buffer: Buffer,
    contentType: string
  ): Promise<CommunityWithStats> {
    const community = await requireEditor(viewer, id);
    const uploaded = await uploadImage(buffer, contentType, uploadOptions());
    return applyImage(viewer, community, 'cover', uploaded);
  },

  async removeCover(viewer: Viewer, id: string): Promise<CommunityWithStats> {
    const community = await requireEditor(viewer, id);
    if (!community.coverUrl && !community.coverPublicId) return community;
    return applyImage(viewer, community, 'cover', { url: null, publicId: null });
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

  /* ─────────────────────── Sugestões de eventos ─────────────────────────── */

  async suggestEvent(
    viewer: Viewer,
    id: string,
    input: EventSuggestionInput
  ): Promise<CommunityEventSuggestion> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canSuggestEvent(actor)) deny();

    // `message` é da sugestão, não do evento: `createEventSchema` é strict.
    const { message, ...eventPayload } = input;
    const parsed = createEventSchema.safeParse({
      ...eventPayload,
      event: { ...input.event, community_id: community.id },
    });
    if (!parsed.success) {
      throw new ValidationError('Verifique os campos indicados.', zodFields(parsed.error));
    }

    const suggestion = await communityRepository.createEventSuggestion({
      communityId: community.id,
      hostId: viewer.hostId,
      title: parsed.data.event.title,
      payload: { event: parsed.data.event, guests: parsed.data.guests },
      message: message?.trim() || null,
    });

    const staff = (await communityRepository.listMembers(community.id)).filter(
      (item) => item.status === 'active' && (item.role === 'owner' || item.role === 'manager')
    );
    const actorName = await displayNameOf(viewer.hostId);
    for (const person of staff) {
      await enqueueNotice({
        recipientEmail: person.email,
        recipientHostId: person.hostId,
        referenceId: suggestion.id,
        kind: 'event_suggestion_received',
        communityName: community.name,
        communitySlug: community.slug,
        actorName,
        recipientName: person.displayName,
        eventTitle: suggestion.title,
      });
    }
    return suggestion;
  },

  async listPendingEventSuggestions(
    viewer: Viewer,
    id: string
  ): Promise<CommunityEventSuggestion[]> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canDecideEventSuggestions(actor)) deny();
    return communityRepository.listPendingEventSuggestions(community.id);
  },

  async listMyEventSuggestions(
    viewer: Viewer,
    id: string
  ): Promise<CommunityEventSuggestion[]> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canSuggestEvent(actor)) deny();
    return communityRepository.listMyEventSuggestions(community.id, viewer.hostId);
  },

  async decideEventSuggestion(
    viewer: Viewer,
    id: string,
    suggestionId: string,
    approve: boolean
  ): Promise<CommunityEventSuggestion> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canDecideEventSuggestions(actor)) deny();

    const suggestion = await communityRepository.findEventSuggestion(suggestionId);
    if (!suggestion || suggestion.communityId !== community.id) {
      throw new NotFoundError('Sugestão não encontrada.', 'community_suggestion_not_found');
    }
    if (suggestion.status !== 'pending') {
      throw new ConflictError('A sugestão já foi decidida.', 'community_suggestion_decided');
    }

    const actorName = await displayNameOf(viewer.hostId);
    const outcome = await withTransaction(async (client) => {
      const locked = await communityRepository.findEventSuggestion(suggestionId, client);
      if (!locked || locked.communityId !== community.id) {
        throw new NotFoundError('Sugestão não encontrada.', 'community_suggestion_not_found');
      }
      if (locked.status !== 'pending') {
        throw new ConflictError('A sugestão já foi decidida.', 'community_suggestion_decided');
      }

      let created: CreatedEventResult | null = null;
      if (approve) {
        // O payload voltou do JSONB: datas são strings e `createEventSchema`
        // volta a coercioná-las. A comunidade é fixada de novo para que um
        // payload antigo/adulterado não crie o evento noutro contexto.
        const payload = locked.payload as {
          event?: Record<string, unknown>;
          guests?: unknown[];
        };
        const parsed = createEventSchema.safeParse({
          ...payload,
          event: { ...(payload.event ?? {}), community_id: community.id },
        });
        if (!parsed.success) {
          throw new ValidationError('A sugestão já não é válida.', zodFields(parsed.error));
        }
        created = await eventService.create(parsed.data, {
          hostId: locked.hostId,
          client,
          deferManageLink: true,
        });
      }

      const decided = await communityRepository.decideEventSuggestion(
        suggestionId,
        approve ? 'approved' : 'rejected',
        viewer.hostId,
        created?.event.id ?? null,
        client
      );
      if (!decided) {
        throw new ConflictError('A sugestão já foi decidida.', 'community_suggestion_decided');
      }

      await enqueueNotice(
        {
          recipientEmail: suggestion.email,
          recipientHostId: suggestion.hostId,
          referenceId: suggestion.id,
          kind: approve ? 'event_suggestion_approved' : 'event_suggestion_rejected',
          communityName: community.name,
          communitySlug: community.slug,
          actorName,
          recipientName: suggestion.displayName,
          eventTitle: suggestion.title,
        },
        client
      );

      const status: EventSuggestionStatus = approve ? 'approved' : 'rejected';
      return {
        suggestion: {
          ...locked,
          status,
          decidedBy: viewer.hostId,
          decidedAt: new Date(),
          eventId: created?.event.id ?? null,
        },
        event: created?.event ?? null,
        pendingManageLink: created?.pendingManageLink ?? null,
      };
    });

    if (outcome.event && outcome.pendingManageLink) {
      await eventService.deliverManageLink(outcome.event, outcome.pendingManageLink);
    }
    return outcome.suggestion;
  },

  async cancelEventSuggestion(viewer: Viewer, id: string, suggestionId: string): Promise<void> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canSuggestEvent(actor)) deny();

    const suggestion = await communityRepository.findEventSuggestion(suggestionId);
    if (
      !suggestion ||
      suggestion.communityId !== community.id ||
      suggestion.hostId !== viewer.hostId
    ) {
      throw new NotFoundError('Sugestão não encontrada.', 'community_suggestion_not_found');
    }
    if (suggestion.status !== 'pending') {
      throw new ConflictError('A sugestão já foi decidida.', 'community_suggestion_decided');
    }

    await withTransaction(async (client) => {
      const decided = await communityRepository.decideEventSuggestion(
        suggestionId,
        'cancelled',
        viewer.hostId,
        null,
        client
      );
      if (!decided) {
        throw new ConflictError('A sugestão já foi decidida.', 'community_suggestion_decided');
      }
    });
  },

  /* ─────────────────────── Feed de actividade ───────────────────────────── */

  /**
   * Acção "Partilhar" do feed. Só membros activos partilham. Um evento
   * público pode ser partilhado em qualquer comunidade; um evento privado
   * apenas na comunidade a que pertence.
   */
  async shareActivity(
    viewer: Viewer,
    id: string,
    eventId: string
  ): Promise<{ activity: CommunityActivity; created: boolean }> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canShareEvents(actor)) {
      deny('Só membros activos podem partilhar eventos na comunidade.');
    }

    // `findById` já exclui eventos apagados (`deleted_at IS NOT NULL`).
    const event = await eventRepository.findById(eventId);
    if (!event) {
      throw new NotFoundError('Evento não encontrado.', 'community_activity_event_not_found');
    }
    if (event.visibility !== 'public' && event.communityId !== community.id) {
      throw new ForbiddenError(
        'Este evento não pode ser partilhado nesta comunidade.',
        'community_activity_forbidden'
      );
    }

    return communityRepository.createCommunityActivity({
      communityId: community.id,
      hostId: viewer.hostId,
      eventId,
    });
  },

  async listActivity(viewer: Viewer, id: string): Promise<CommunityActivity[]> {
    const community = await this.load(viewer, id);
    const { actor } = await this.actor(community.id, viewer.hostId);
    if (!communityPermissions.canShareEvents(actor)) {
      deny('Só membros activos podem ver a actividade da comunidade.');
    }
    return communityRepository.listCommunityActivity(community.id, 50);
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
