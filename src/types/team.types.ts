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

/**
 * Papel da conta autenticada **na equipa**.
 *
 * `anfitriao` só se aplica ao anfitrião do evento; os restantes usam o
 * papel da linha em `team_members` (`gestor`/`membro`).
 */
export const TEAM_MY_ROLES = ['anfitriao', 'gestor', 'membro'] as const;
export type TeamMyRole = (typeof TEAM_MY_ROLES)[number];

/**
 * Fuso usado para encerrar eventos sem `ends_at`.
 *
 * A regra é de produto (mercado angolano), não do fuso configurado no
 * evento: sem fim explícito, o evento termina às 06:00 do dia seguinte
 * ao de `starts_at`, em Africa/Luanda.
 */
export const TEAM_EVENT_TIMEZONE = 'Africa/Luanda';
export const TEAM_EVENT_END_HOUR = 6;

/**
 * Estado observável do evento para os filtros da lista de equipas.
 *
 * É derivado de `events.status` e das datas: um evento `scheduled`
 * ainda por começar está `agendado`; a decorrer, `em_curso`; com
 * `ends_at` no passado, `concluido`. Sem `ends_at`, termina às 06:00
 * do dia seguinte ao de `starts_at` em Africa/Luanda.
 */
export const TEAM_EVENT_STATUSES = [
  'agendado',
  'em_curso',
  'concluido',
  'cancelado',
  'rascunho',
] as const;
export type TeamEventStatus = (typeof TEAM_EVENT_STATUSES)[number];

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

/** Membro devolvido na pré-visualização do cartão da equipa. */
export interface TeamMemberPreview {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface TeamWithStats extends Team {
  eventTitle: string;
  /** Estado observável do evento, derivado de `status` e das datas. */
  eventStatus: TeamEventStatus;
  memberCount: number;
  openTaskCount: number;
  /** Total de tarefas não arquivadas. */
  taskCount: number;
  /** Tarefas concluídas entre as não arquivadas. */
  completedTaskCount: number;
  /** Até 4 membros, por ordem de entrada, sem emails. */
  membersPreview: TeamMemberPreview[];
  /**
   * Papel da conta autenticada na equipa. Preenchido pelas respostas da
   * API (`GET /host/teams` e detalhe); ausente em leituras internas.
   */
  myRole?: TeamMyRole;
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

/**
 * Convite de equipa enviado por email.
 *
 * Guarda apenas o HMAC do token (`tokenHash`); o token em claro só
 * existe no link entregue ao convidado e no email cifrado da outbox.
 */
export interface TeamInvite {
  id: string;
  memberId: string;
  teamId: string;
  email: string;
  /** Anfitrião que criou o convite; identifica o remetente original. */
  createdByHostId: string | null;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  sendCount: number;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Convite com o contexto necessário para validar e aceitar. */
export interface TeamInviteContext extends TeamInvite {
  teamName: string;
  eventId: string;
  eventTitle: string;
  /** Nome de quem convida (display name ou email do anfitrião remetente). */
  inviterName: string | null;
  memberDisplayName: string | null;
  memberHostId: string | null;
  memberStatus: TeamMemberStatus;
  memberRemovedAt: Date | null;
}
