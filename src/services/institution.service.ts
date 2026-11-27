import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  InstitutionRow,
  LinkRequestRow,
  institutionRepository,
} from '../repositories/institution.repository';
import { links } from '../utils/links.util';
import { generateToken } from '../utils/token.util';
import { slugify } from './community.service';
import { destroyImage, uploadImage } from './cloudinary.service';
import { assertPurposeOtp, requestPurposeOtp } from './purposeOtp.service';

export interface InstitutionViewer {
  hostId: string;
  email: string;
}

const NOT_FOUND = 'Instituição não encontrada.';

/** Permissões das instituições (Bloco 13): só o criador administra. */
export const institutionPermissions = {
  canAdminister: (institution: Pick<InstitutionRow, 'creator_id'>, hostId: string): boolean =>
    institution.creator_id === hostId,
  /** Pedir/aceitar/sair em nome de uma comunidade: só o seu responsável. */
  canActForCommunity: (community: { owner_id: string }, hostId: string): boolean => community.owner_id === hostId,
};

function deny(message = 'Não tem permissão para esta ação.'): never {
  throw new ForbiddenError(message, 'institution_forbidden');
}

type InstitutionImageKind = 'avatar' | 'cover';

interface StoredImage {
  url: string | null;
  publicId: string | null;
}

/** Só o criador administra a instituição. */
async function requireEditor(idOrSlug: string, viewer: InstitutionViewer): Promise<InstitutionRow> {
  const institution = await institutionService.load(idOrSlug, viewer);
  if (!institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
  return institution;
}

async function applyImage(
  viewer: InstitutionViewer,
  institution: InstitutionRow,
  kind: InstitutionImageKind,
  image: StoredImage
) {
  const previousPublicId =
    kind === 'avatar' ? institution.avatar_public_id : institution.cover_public_id;

  await institutionRepository.update(
    institution.id,
    kind === 'avatar'
      ? { avatar_url: image.url, avatar_public_id: image.publicId }
      : { cover_url: image.url, cover_public_id: image.publicId }
  );

  if (previousPublicId && previousPublicId !== image.publicId) {
    await destroyImage(previousPublicId);
  }

  const updated = await institutionRepository.find(institution.id);
  if (!updated) throw new NotFoundError(NOT_FOUND, 'institution_not_found');
  return toInstitutionDto(updated, viewer.hostId);
}

function uploadOptions() {
  return {
    folder: env.CLOUDINARY_INSTITUTION_FOLDER,
    unavailableMessage: 'O upload da imagem da instituição não está configurado.',
    unavailableCode: 'institution_image_upload_unavailable',
  };
}

function toInstitutionDto(row: InstitutionRow, viewerId: string) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    community_count: row.community_count,
    is_creator: row.creator_id === viewerId,
    created_at: row.created_at.toISOString(),
  };
}

function toRequestDto(row: LinkRequestRow) {
  return {
    id: row.id,
    institution_id: row.institution_id,
    institution_name: row.institution_name,
    community_id: row.community_id,
    community_name: row.community_name,
    community_slug: row.community_slug,
    direction: row.direction,
    kind: row.kind,
    status: row.status,
    community_accepted: row.community_accepted_at !== null,
    created_at: row.created_at.toISOString(),
  };
}

export const institutionService = {
  async load(idOrSlug: string, viewer: InstitutionViewer): Promise<InstitutionRow> {
    const institution = await institutionRepository.find(idOrSlug);
    if (!institution) throw new NotFoundError(NOT_FOUND, 'institution_not_found');
    if (institution.visibility === 'private' && institution.creator_id !== viewer.hostId) {
      const communities = await institutionRepository.communities(institution.id);
      if (!communities.some((community) => community.owner_id === viewer.hostId)) {
        throw new NotFoundError(NOT_FOUND, 'institution_not_found');
      }
    }
    return institution;
  },

  async list(viewer: InstitutionViewer, scope: 'mine' | 'discover', q?: string) {
    const rows = scope === 'discover' ? await institutionRepository.listPublic(30, 0, q) : await institutionRepository.listForHost(viewer.hostId);
    return rows.map((row) => toInstitutionDto(row, viewer.hostId));
  },

  async detail(idOrSlug: string, viewer: InstitutionViewer) {
    const institution = await this.load(idOrSlug, viewer);
    const isCreator = institutionPermissions.canAdminister(institution, viewer.hostId);
    const [communities, events, requests] = await Promise.all([
      institutionRepository.communities(institution.id),
      institutionRepository.upcomingEvents(institution.id, 12),
      isCreator ? institutionRepository.openRequestsForInstitution(institution.id) : Promise.resolve([]),
    ]);
    return {
      institution: toInstitutionDto(institution, viewer.hostId),
      communities: communities
        // Comunidades privadas só aparecem ao criador e ao próprio responsável.
        .filter((community) => community.visibility === 'public' || isCreator || community.owner_id === viewer.hostId)
        .map((community) => ({
          id: community.id,
          name: community.name,
          slug: community.slug,
          visibility: community.visibility,
          avatar_url: community.avatar_url,
          member_count: community.member_count,
          i_own: community.owner_id === viewer.hostId,
        })),
      events: events.map((event) => ({
        id: event.id,
        title: event.title,
        starts_at: event.starts_at.toISOString(),
        timezone: event.timezone,
        cover_url: event.cover_url,
        public_url: links.publicEvent(event.public_slug),
        community_name: event.community_name,
      })),
      requests: requests.map(toRequestDto),
    };
  },

  async create(viewer: InstitutionViewer, input: { name: string; description?: string | null; visibility: 'public' | 'private' }) {
    const base = slugify(input.name);
    let slug = base;
    for (let attempt = 0; attempt < 5 && (await institutionRepository.slugExists(slug)); attempt += 1) {
      slug = `${base}-${generateToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || attempt}`;
    }
    const id = await institutionRepository.create({
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      visibility: input.visibility,
      creatorId: viewer.hostId,
    });
    const created = await institutionRepository.find(id);
    if (!created) throw new Error('Falha ao ler a instituição criada.');
    return toInstitutionDto(created, viewer.hostId);
  },

  async update(
    idOrSlug: string,
    viewer: InstitutionViewer,
    input: { name?: string; description?: string | null; visibility?: 'public' | 'private'; avatar_url?: string | null; cover_url?: string | null }
  ) {
    const institution = await this.load(idOrSlug, viewer);
    if (!institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
    await institutionRepository.update(institution.id, {
      name: input.name?.trim(),
      description: 'description' in input ? input.description?.trim() || null : undefined,
      visibility: input.visibility,
      avatar_url: 'avatar_url' in input ? input.avatar_url ?? null : undefined,
      cover_url: 'cover_url' in input ? input.cover_url ?? null : undefined,
      avatar_public_id: 'avatar_url' in input ? null : undefined,
      cover_public_id: 'cover_url' in input ? null : undefined,
    });
    if ('avatar_url' in input && institution.avatar_public_id) {
      await destroyImage(institution.avatar_public_id);
    }
    if ('cover_url' in input && institution.cover_public_id) {
      await destroyImage(institution.cover_public_id);
    }
    const updated = await institutionRepository.find(institution.id);
    if (!updated) throw new NotFoundError(NOT_FOUND, 'institution_not_found');
    return toInstitutionDto(updated, viewer.hostId);
  },

  async setAvatarFromUrl(idOrSlug: string, viewer: InstitutionViewer, url: string) {
    const institution = await requireEditor(idOrSlug, viewer);
    if (institution.avatar_url === url && !institution.avatar_public_id) {
      return toInstitutionDto(institution, viewer.hostId);
    }
    return applyImage(viewer, institution, 'avatar', { url, publicId: null });
  },

  async uploadAvatar(
    idOrSlug: string,
    viewer: InstitutionViewer,
    buffer: Buffer,
    contentType: string
  ) {
    const institution = await requireEditor(idOrSlug, viewer);
    const uploaded = await uploadImage(buffer, contentType, uploadOptions());
    return applyImage(viewer, institution, 'avatar', uploaded);
  },

  async removeAvatar(idOrSlug: string, viewer: InstitutionViewer) {
    const institution = await requireEditor(idOrSlug, viewer);
    if (!institution.avatar_url && !institution.avatar_public_id) {
      return toInstitutionDto(institution, viewer.hostId);
    }
    return applyImage(viewer, institution, 'avatar', { url: null, publicId: null });
  },

  async setCoverFromUrl(idOrSlug: string, viewer: InstitutionViewer, url: string) {
    const institution = await requireEditor(idOrSlug, viewer);
    if (institution.cover_url === url && !institution.cover_public_id) {
      return toInstitutionDto(institution, viewer.hostId);
    }
    return applyImage(viewer, institution, 'cover', { url, publicId: null });
  },

  async uploadCover(
    idOrSlug: string,
    viewer: InstitutionViewer,
    buffer: Buffer,
    contentType: string
  ) {
    const institution = await requireEditor(idOrSlug, viewer);
    const uploaded = await uploadImage(buffer, contentType, uploadOptions());
    return applyImage(viewer, institution, 'cover', uploaded);
  },

  async removeCover(idOrSlug: string, viewer: InstitutionViewer) {
    const institution = await requireEditor(idOrSlug, viewer);
    if (!institution.cover_url && !institution.cover_public_id) {
      return toInstitutionDto(institution, viewer.hostId);
    }
    return applyImage(viewer, institution, 'cover', { url: null, publicId: null });
  },

  async remove(idOrSlug: string, viewer: InstitutionViewer, confirmName: string): Promise<void> {
    const institution = await this.load(idOrSlug, viewer);
    if (!institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
    if (confirmName.trim() !== institution.name.trim()) {
      throw new ValidationError('Escreva o nome da instituição para confirmar.', {
        confirm_name: ['Escreva o nome da instituição para confirmar.'],
      });
    }
    await withTransaction((client) => institutionRepository.softDelete(institution.id, client));
  },

  /* ───────────────────────── Pedidos de associação ───────────────────────── */

  /** Comunidade (órfã) pede para entrar: só o seu responsável. */
  async requestFromCommunity(idOrSlug: string, viewer: InstitutionViewer, communityId: string) {
    const institution = await this.load(idOrSlug, viewer);
    const community = await institutionRepository.findCommunity(communityId);
    if (!community) throw new NotFoundError('Comunidade não encontrada.', 'community_not_found');
    if (!institutionPermissions.canActForCommunity(community, viewer.hostId)) deny();
    return this.openRequest(institution.id, community, viewer.hostId, 'community_to_institution');
  },

  /** A instituição convida uma comunidade (órfã): só o criador. */
  async inviteCommunity(idOrSlug: string, viewer: InstitutionViewer, communityId: string) {
    const institution = await this.load(idOrSlug, viewer);
    if (!institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
    const community = await institutionRepository.findCommunity(communityId);
    if (!community) throw new NotFoundError('Comunidade não encontrada.', 'community_not_found');
    return this.openRequest(institution.id, community, viewer.hostId, 'institution_to_community');
  },

  async openRequest(
    institutionId: string,
    community: { id: string; institution_id: string | null },
    hostId: string,
    direction: LinkRequestRow['direction']
  ) {
    if (community.institution_id) {
      throw new ConflictError('Esta comunidade já pertence a uma instituição.', 'community_has_institution');
    }
    try {
      const id = await institutionRepository.createRequest({
        institutionId,
        communityId: community.id,
        direction,
        kind: 'link',
        requestedBy: hostId,
        // Pedido da própria comunidade já conta como aceite por ela.
        communityAccepted: direction === 'community_to_institution',
      });
      const created = await institutionRepository.findRequest(id);
      if (!created) throw new Error('Falha ao ler o pedido.');
      return toRequestDto(created);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('Já existe um pedido aberto para esta comunidade.', 'institution_request_open');
      }
      throw error;
    }
  },

  /** O responsável da comunidade aceita o convite da instituição. */
  async acceptInvite(requestId: string, viewer: InstitutionViewer) {
    const request = await institutionRepository.findRequest(requestId);
    if (!request || request.status !== 'pending' || request.direction !== 'institution_to_community') {
      throw new NotFoundError('Pedido não encontrado.', 'institution_request_not_found');
    }
    const community = await institutionRepository.findCommunity(request.community_id);
    if (!community || !institutionPermissions.canActForCommunity(community, viewer.hostId)) deny();
    await institutionRepository.acceptByCommunity(request.id);
  },

  /** Recusar: o criador (qualquer pedido) ou o responsável da comunidade (o convite). */
  async reject(requestId: string, viewer: InstitutionViewer): Promise<void> {
    const request = await institutionRepository.findRequest(requestId);
    if (!request || !['pending', 'awaiting_otp'].includes(request.status)) {
      throw new NotFoundError('Pedido não encontrado.', 'institution_request_not_found');
    }
    const institution = await institutionRepository.find(request.institution_id);
    const community = await institutionRepository.findCommunity(request.community_id);
    const allowed =
      (institution && institutionPermissions.canAdminister(institution, viewer.hostId)) ||
      (community && institutionPermissions.canActForCommunity(community, viewer.hostId));
    if (!allowed) deny();
    await institutionRepository.setRequestStatus(request.id, 'rejected', viewer.hostId);
  },

  /**
   * Passo 1 do criador: aprova e recebe um OTP por email. Só depois de a
   * comunidade ter aceitado (pedidos da comunidade já vêm aceites).
   */
  async startApproval(requestId: string, viewer: InstitutionViewer) {
    const request = await institutionRepository.findRequest(requestId);
    if (!request || !['pending', 'awaiting_otp'].includes(request.status)) {
      throw new NotFoundError('Pedido não encontrado.', 'institution_request_not_found');
    }
    const institution = await institutionRepository.find(request.institution_id);
    if (!institution || !institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
    if (request.kind === 'link' && !request.community_accepted_at) {
      throw new ConflictError('A comunidade ainda não aceitou o convite.', 'institution_community_pending');
    }
    const { expiresAt } = await requestPurposeOtp(viewer.email, 'institution_link', {
      communityName: request.community_name,
      institutionName: request.institution_name,
    });
    await institutionRepository.setRequestStatus(request.id, 'awaiting_otp', null, undefined, expiresAt);
    return { ...toRequestDto(request), status: 'awaiting_otp' as const };
  },

  /** Passo 2 do criador: confirma com o OTP; liga ou remove de forma atómica. */
  async confirmApproval(requestId: string, viewer: InstitutionViewer, code: string) {
    const request = await institutionRepository.findRequest(requestId);
    if (!request || request.status !== 'awaiting_otp') {
      throw new NotFoundError('Pedido não encontrado.', 'institution_request_not_found');
    }
    const institution = await institutionRepository.find(request.institution_id);
    if (!institution || !institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
    await assertPurposeOtp(viewer.email, 'institution_link', code);

    await withTransaction(async (client) => {
      const changed =
        request.kind === 'remove'
          ? await institutionRepository.unlink(request.community_id, request.institution_id, client)
          : await institutionRepository.link(request.community_id, request.institution_id, client);
      if (!changed) {
        throw new ConflictError(
          request.kind === 'remove'
            ? 'A comunidade já não pertence a esta instituição.'
            : 'Esta comunidade já pertence a uma instituição.',
          'community_has_institution'
        );
      }
      await institutionRepository.setRequestStatus(request.id, 'approved', viewer.hostId, client);
    });
    return { ...toRequestDto(request), status: 'approved' as const };
  },

  /** O criador remove uma comunidade: abre um pedido `remove` que exige OTP. */
  async startRemoval(idOrSlug: string, viewer: InstitutionViewer, communityId: string) {
    const institution = await this.load(idOrSlug, viewer);
    if (!institutionPermissions.canAdminister(institution, viewer.hostId)) deny();
    const community = await institutionRepository.findCommunity(communityId);
    if (!community || community.institution_id !== institution.id) {
      throw new NotFoundError('Comunidade não encontrada.', 'community_not_found');
    }
    const id = await institutionRepository.createRequest({
      institutionId: institution.id,
      communityId,
      direction: 'institution_to_community',
      kind: 'remove',
      requestedBy: viewer.hostId,
      communityAccepted: true,
    });
    return this.startApproval(id, viewer);
  },

  /** O responsável da comunidade sai da instituição (decisão da própria comunidade). */
  async leave(idOrSlug: string, viewer: InstitutionViewer, communityId: string): Promise<void> {
    const institution = await this.load(idOrSlug, viewer);
    const community = await institutionRepository.findCommunity(communityId);
    if (!community || community.institution_id !== institution.id) {
      throw new NotFoundError('Comunidade não encontrada.', 'community_not_found');
    }
    if (!institutionPermissions.canActForCommunity(community, viewer.hostId)) deny();
    await institutionRepository.unlink(community.id, institution.id);
  },

  async myRequests(viewer: InstitutionViewer) {
    return (await institutionRepository.openRequestsForOwner(viewer.hostId)).map(toRequestDto);
  },
};
