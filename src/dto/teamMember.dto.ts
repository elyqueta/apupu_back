import {
  TeamMemberAddResult,
  TeamMemberWithStats,
  UpdateMemberRoleResult,
} from '../types/team.types';

export interface TeamMemberDto {
  id: string;
  team_id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  role: string;
  status: string;
  origin: string;
  is_host: boolean;
  open_task_count: number;
  /** `false` → mostrar "Responsável sem acesso". */
  has_event_access: boolean;
  joined_at: string | null;
  created_at: string;
}

export function toTeamMemberDto(member: TeamMemberWithStats): TeamMemberDto {
  return {
    id: member.id,
    team_id: member.teamId,
    email: member.email,
    phone: member.phone,
    display_name: member.displayName,
    role: member.role,
    status: member.status,
    origin: member.origin,
    is_host: member.isHost,
    open_task_count: member.openTaskCount,
    has_event_access: member.hasEventAccess,
    joined_at: member.joinedAt?.toISOString() ?? null,
    created_at: member.createdAt.toISOString(),
  };
}

export interface UpdateMemberRoleDto {
  member: TeamMemberDto;
  event_manager_id: string | null;
  access_code?: string;
  access_link?: string;
}

export function toUpdateMemberRoleDto(result: UpdateMemberRoleResult): UpdateMemberRoleDto {
  return {
    member: toTeamMemberDto(result.member),
    event_manager_id: result.eventManagerId,
    ...(result.accessCode ? { access_code: result.accessCode } : {}),
    ...(result.accessLink ? { access_link: result.accessLink } : {}),
  };
}

export interface TeamMemberAddRowDto {
  email: string | null;
  phone?: string | null;
  member_id: string | null;
  status: string;
  reason?: string;
}

export interface AddTeamMembersDto {
  added: TeamMemberAddRowDto[];
  pending: TeamMemberAddRowDto[];
  skipped: TeamMemberAddRowDto[];
}

function toAddRow(row: TeamMemberAddResult): TeamMemberAddRowDto {
  return {
    email: row.email,
    phone: row.phone ?? null,
    member_id: row.memberId,
    status: row.status,
    reason: row.reason,
  };
}

export function toAddTeamMembersDto(result: {
  added: TeamMemberAddResult[];
  pending: TeamMemberAddResult[];
  skipped: TeamMemberAddResult[];
}): AddTeamMembersDto {
  return {
    added: result.added.map(toAddRow),
    pending: result.pending.map(toAddRow),
    skipped: result.skipped.map(toAddRow),
  };
}
