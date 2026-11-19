import {
  TeamEventStatus,
  TeamMyRole,
  TeamWithStats,
} from '../types/team.types';

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
  open_task_count: number;
  created_at: string;
  updated_at: string;
}

export function toTeamDto(team: TeamWithStats): TeamDto {
  return {
    id: team.id,
    event_id: team.eventId,
    event_title: team.eventTitle,
    event_status: team.eventStatus,
    my_role: team.myRole ?? 'membro',
    name: team.name,
    category: team.category,
    description: team.description,
    member_count: team.memberCount,
    open_task_count: team.openTaskCount,
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
