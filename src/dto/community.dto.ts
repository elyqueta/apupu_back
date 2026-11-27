import { CommunityDetail } from '../services/community.service';
import {
  CommunityActivity,
  CommunityEventSuggestion,
  CommunityEventSummary,
  CommunityJoinRequest,
  CommunityMember,
  CommunityReferralStat,
  CommunityTeamSummary,
  CommunityTransfer,
  CommunityWithStats,
} from '../types/community.types';
import { links } from '../utils/links.util';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toCommunityDto(community: CommunityWithStats) {
  return {
    id: community.id,
    name: community.name,
    slug: community.slug,
    description: community.description,
    visibility: community.visibility,
    avatar_url: community.avatarUrl,
    cover_url: community.coverUrl,
    member_count: community.memberCount,
    event_count: community.eventCount,
    team_count: community.teamCount,
    my_role: community.myRole,
    my_status: community.myStatus,
    my_pending_request: community.myPendingRequest,
    institution: community.institution,
    url: links.community(community.slug),
    created_at: community.createdAt.toISOString(),
  };
}

/**
 * Membro visto por outros membros: nome, foto, papel e estado. O email só
 * é devolvido a gestores/responsável (`includeContact`); o telefone nunca.
 */
export function toCommunityMemberDto(member: CommunityMember, includeContact: boolean) {
  return {
    id: member.id,
    host_id: member.hostId,
    display_name: member.displayName,
    email: includeContact ? member.email : null,
    avatar_url: member.avatarUrl,
    role: member.role,
    status: member.status,
    has_host_account: member.hasHostAccount,
    joined_at: iso(member.joinedAt),
  };
}

export function toJoinRequestDto(request: CommunityJoinRequest) {
  return {
    id: request.id,
    host_id: request.hostId,
    display_name: request.displayName,
    email: request.email,
    avatar_url: request.avatarUrl,
    message: request.message,
    status: request.status,
    created_at: request.createdAt.toISOString(),
  };
}

/** Entrada do feed da comunidade, no formato consumido pelo frontend. */
export function toCommunityActivityDto(activity: CommunityActivity) {
  return {
    id: activity.id,
    community_id: activity.communityId,
    host_id: activity.hostId,
    host_name: activity.hostName,
    host_avatar_url: activity.hostAvatarUrl,
    event_id: activity.eventId,
    event_title: activity.eventTitle,
    event_slug: activity.eventSlug,
    created_at: activity.createdAt.toISOString(),
  };
}

/** Nunca inclui o payload completo: a listagem não expõe convidados. */
export function toEventSuggestionDto(suggestion: CommunityEventSuggestion) {
  return {
    id: suggestion.id,
    host_id: suggestion.hostId,
    display_name: suggestion.displayName,
    avatar_url: suggestion.avatarUrl,
    title: suggestion.title,
    message: suggestion.message,
    status: suggestion.status,
    event_id: suggestion.eventId,
    decided_at: iso(suggestion.decidedAt),
    created_at: suggestion.createdAt.toISOString(),
    updated_at: suggestion.updatedAt.toISOString(),
  };
}

export function toTransferDto(transfer: CommunityTransfer, viewerId: string) {
  return {
    id: transfer.id,
    status: transfer.status,
    direction: transfer.fromHostId === viewerId ? 'outgoing' : 'incoming',
    otp_expires_at: iso(transfer.otpExpiresAt),
    created_at: transfer.createdAt.toISOString(),
  };
}

function toEventSummaryDto(event: CommunityEventSummary) {
  return {
    id: event.id,
    title: event.title,
    starts_at: event.startsAt.toISOString(),
    status: event.status,
    visibility: event.visibility,
    public_url: event.visibility === 'public' && event.publicSlug ? links.publicEvent(event.publicSlug) : null,
    cover_url: event.coverUrl,
    accepted_count: event.acceptedCount,
  };
}

function toTeamSummaryDto(team: CommunityTeamSummary) {
  return {
    id: team.id,
    name: team.name,
    category: team.category,
    member_count: team.memberCount,
    event_count: team.eventCount,
  };
}

export function toReferralDto(stat: CommunityReferralStat) {
  return {
    member_id: stat.memberId,
    display_name: stat.displayName,
    invitations: stat.invitations,
    accepted: stat.accepted,
  };
}

export function toCommunityDetailDto(detail: CommunityDetail, viewerId: string) {
  const staff = detail.permissions['canDecideRequests'] === true;
  return {
    community: toCommunityDto(detail.community),
    permissions: detail.permissions,
    my_ref_code: detail.myRefCode,
    events: detail.events.map(toEventSummaryDto),
    teams: detail.teams.map(toTeamSummaryDto),
    members: detail.members.map((member) => toCommunityMemberDto(member, staff)),
    pending_requests: detail.pendingRequests,
    pending_event_suggestions: detail.pendingEventSuggestions,
    transfer: detail.transfer ? toTransferDto(detail.transfer, viewerId) : null,
  };
}
