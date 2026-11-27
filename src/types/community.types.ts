/** Tipos do domínio de comunidades (Bloco 11). */

export const COMMUNITY_VISIBILITIES = ['public', 'private'] as const;
export type CommunityVisibility = (typeof COMMUNITY_VISIBILITIES)[number];

export const COMMUNITY_ROLES = ['owner', 'manager', 'member'] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

export type CommunityMemberStatus = 'active' | 'invited' | 'left' | 'removed';
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type EventSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TransferStatus =
  | 'pending_otp'
  | 'pending_accept'
  | 'completed'
  | 'cancelled'
  | 'expired';

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: CommunityVisibility;
  ownerId: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  /** IDs do Cloudinary, usados apenas para limpar a imagem anterior. */
  avatarPublicId?: string | null;
  coverPublicId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Comunidade com contagens e o papel de quem consulta (`null` = não membro). */
export interface CommunityWithStats extends Community {
  memberCount: number;
  eventCount: number;
  teamCount: number;
  myRole: CommunityRole | null;
  myStatus: CommunityMemberStatus | null;
  /** Pedido de adesão pendente de quem consulta. */
  myPendingRequest: boolean;
  /** Instituição a que a comunidade pertence (Bloco 13). */
  institution: { name: string; slug: string } | null;
}

export interface CommunityMember {
  id: string;
  communityId: string;
  hostId: string | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: CommunityRole;
  status: CommunityMemberStatus;
  refCode: string;
  /** `true` quando a pessoa tem conta de anfitrião (pode receber a responsabilidade). */
  hasHostAccount: boolean;
  joinedAt: Date | null;
  createdAt: Date;
}

export interface CommunityJoinRequest {
  id: string;
  communityId: string;
  hostId: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  message: string | null;
  status: JoinRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/**
 * Sugestão de evento: o payload guarda o corpo completo aceite por
 * `createEventSchema` (evento + convidados) para recriar o evento na
 * aprovação. Nunca é exposto nos DTOs de listagem.
 */
export interface CommunityEventSuggestion {
  id: string;
  communityId: string;
  hostId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  title: string;
  payload: Record<string, unknown>;
  message: string | null;
  status: EventSuggestionStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  eventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunityTransfer {
  id: string;
  communityId: string;
  fromHostId: string;
  toHostId: string;
  status: TransferStatus;
  otpExpiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** Partilhas rastreadas: convites aceites por membro (`?ref=`). */
export interface CommunityReferralStat {
  memberId: string;
  displayName: string | null;
  email: string | null;
  invitations: number;
  accepted: number;
}

/** Evento resumido na página da comunidade. */
export interface CommunityEventSummary {
  id: string;
  title: string;
  startsAt: Date;
  status: string;
  visibility: 'public' | 'private';
  publicSlug: string | null;
  coverUrl: string | null;
  acceptedCount: number;
}

/** Entrada do feed da comunidade (acção "Partilhar"). */
export interface CommunityActivity {
  id: string;
  communityId: string;
  hostId: string;
  hostName: string | null;
  hostAvatarUrl: string | null;
  eventId: string;
  eventTitle: string;
  eventSlug: string | null;
  createdAt: Date;
}

export interface CommunityTeamSummary {
  id: string;
  name: string;
  category: string;
  memberCount: number;
  eventCount: number;
}
