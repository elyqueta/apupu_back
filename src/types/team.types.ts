/**
 * Tipos do domínio de equipas, membros e tarefas por equipa.
 *
 * Uma equipa pertence sempre a um evento. O anfitrião e os gestores do
 * evento são materializados como membros (`is_host` / `role=gestor`),
 * pelo que o responsável de uma tarefa é sempre um `team_member`.
 *
 * Tarefas antigas sem equipa continuam a existir em "Pessoais
 * (legado)" (`team_id = null`), visíveis apenas para quem as criou.
 */

export const TEAM_CATEGORIES = [
  'logistica',
  'decoracao',
  'musica',
  'catering',
  'rececao',
  'outra',
] as const;
export type TeamCategory = (typeof TEAM_CATEGORIES)[number];

export const TEAM_MEMBER_ROLES = ['gestor', 'membro'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export const TEAM_MEMBER_STATUSES = ['ativo', 'convite_pendente'] as const;
export type TeamMemberStatus = (typeof TEAM_MEMBER_STATUSES)[number];

export const TEAM_MEMBER_ORIGINS = ['convidado', 'email'] as const;
export type TeamMemberOrigin = (typeof TEAM_MEMBER_ORIGINS)[number];

export const TASK_STATUSES = ['por_fazer', 'em_curso', 'concluida'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['baixa', 'normal', 'alta'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Filtros de estado aceites na transição (`pending`/`done` são legado). */
export const TASK_STATUS_FILTERS = [
  'all',
  'por_fazer',
  'em_curso',
  'concluida',
  'pending',
  'done',
] as const;
export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number];

export interface Team {
  id: string;
  eventId: string;
  name: string;
  category: TeamCategory;
  description: string | null;
  createdByHostId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamWithStats extends Team {
  eventTitle: string;
  memberCount: number;
  openTaskCount: number;
}

export interface TeamMember {
  id: string;
  teamId: string;
  hostId: string | null;
  email: string;
  displayName: string | null;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  origin: TeamMemberOrigin;
  isHost: boolean;
  invitedByHostId: string | null;
  joinedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMemberWithStats extends TeamMember {
  openTaskCount: number;
  /**
   * `false` quando um gestor perdeu o acesso ao evento
   * (`event_managers.revoked_at`) ou quando o membro foi removido.
   * Nesse caso a tarefa aparece como "Responsável sem acesso".
   */
  hasEventAccess: boolean;
}

export interface Task {
  id: string;
  /** Conta que criou a tarefa (compatibilidade com `host_tasks.host_id`). */
  hostId: string;
  eventId: string | null;
  eventTitle: string | null;
  teamId: string | null;
  teamName: string | null;
  assigneeMemberId: string | null;
  assigneeEmail: string | null;
  assigneeDisplayName: string | null;
  assigneeHasAccess: boolean | null;
  title: string;
  description: string | null;
  /** Dia de calendário `YYYY-MM-DD`, sem hora nem fuso. */
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  createdByHostId: string | null;
  completedByMemberId: string | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  /** Aliases de transição: `label = title`, `done = status === 'concluida'`. */
  label: string;
  done: boolean;
  /** Gestor antigo, mantido apenas para leitura durante a transição. */
  managerId: string | null;
  managerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamGuestCandidate {
  /** Convite que originou a linha (o primeiro da deduplicação por email). */
  invitationId: string;
  eventId: string;
  eventTitle: string;
  eventStartsAt: Date | null;
  eventStatus: string;
  guestName: string;
  guestEmail: string;
  /** `false` quando o convidado não tem email (string vazia). */
  hasEmail: boolean;
  isMember: boolean;
  memberId: string | null;
}

/** Resultado da promoção/despromoção de um membro. */
export interface UpdateMemberRoleResult {
  member: TeamMemberWithStats;
  eventManagerId: string | null;
}

/** Linha devolvida na adição de membros. */
export interface TeamMemberAddResult {
  email: string;
  memberId: string | null;
  status: TeamMemberStatus;
  reason?: string;
}
