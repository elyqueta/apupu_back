import {
  TeamEventStatus,
  TeamMemberPreview,
  TeamMyRole,
  TeamWithStats,
} from '../types/team.types';

export interface TeamMemberPreviewDto {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface TeamDto {
  id: string;
  event_id: string;
  event_title: string;
  event_status: TeamEventStatus;
  my_role: TeamMyRole;
  name: string;
  category: string;
  description: string | null;
  member_count: number;
  task_count: number;
  completed_task_count: number;
  open_task_count: number;
  members_preview: TeamMemberPreviewDto[];
  /** Bloco 11: comunidade, criador e eventos geridos pela equipa. */
  community_id: string | null;
  creator_id: string | null;
  event_ids: string[];
  event_count: number;
  created_at: string;
  updated_at: string;
}

function toMemberPreviewDto(member: TeamMemberPreview): TeamMemberPreviewDto {
  return {
    id: member.id,
    display_name: member.displayName,
    avatar_url: member.avatarUrl,
  };
}

export function toTeamDto(team: TeamWithStats): TeamDto {
  return {
    id: team.id,
    event_id: team.eventId,
    community_id: team.communityId ?? null,
    creator_id: team.createdByHostId,
    event_ids: team.eventIds ?? [team.eventId],
    event_count: (team.eventIds ?? [team.eventId]).length,
    event_title: team.eventTitle,
    event_status: team.eventStatus,
    my_role: team.myRole ?? 'membro',
    name: team.name,
    category: team.category,
    description: team.description,
    member_count: team.memberCount,
    task_count: team.taskCount,
    completed_task_count: team.completedTaskCount,
    open_task_count: team.openTaskCount,
    members_preview: team.membersPreview.map(toMemberPreviewDto),
    created_at: team.createdAt.toISOString(),
    updated_at: team.updatedAt.toISOString(),
  };
}

export interface DeleteTeamDto {
  deleted: true;
  reassigned_to_team_id: string | null;
  reassigned_tasks: number;
  archived_tasks: number;
}

export interface TeamGuestDto {
  invitation_id: string;
  event_id: string;
  event_title: string;
  event_starts_at: string | null;
  event_status: string;
  guest_name: string;
  guest_email: string;
  has_email: boolean;
  is_member: boolean;
  member_id: string | null;
}
