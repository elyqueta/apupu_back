/** Tipos do domínio de eventos. */

export const EVENT_STATUSES = ['draft', 'scheduled', 'cancelled', 'completed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Papel de quem está a gerir o evento. */
export const EVENT_ACCESS_ROLES = ['host', 'manager', 'communityMember'] as const;
export type EventAccessRole = (typeof EVENT_ACCESS_ROLES)[number];


/** Visibilidade: privado (só convites individuais) ou público (link aberto). */
export const EVENT_VISIBILITIES = ['public', 'private'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const LOCATION_TYPES = ['venue', 'online'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const EVENT_CATEGORIES = [
  'wedding',
  'birthday',
  'corporate',
  'baby',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface EventLocation {
  type: LocationType;
  name: string | null;
  address: string | null;
  onlineUrl: string | null;
  /** Bloco 14: localização exata (ambas ou nenhuma). */
  latitude?: number | null;
  longitude?: number | null;
  placeLabel?: string | null;
  placeName?: string | null;
}

export interface EventTheme {
  mode: ThemeMode;
  palette: string;
}

/**
 * Contribuição é opcional. Quando desativada, os campos bancários
 * não existem; quando ativada, os três são obrigatórios (garantido
 * também por constraint na base de dados).
 */
export interface EventContribution {
  enabled: boolean;
  bankName: string | null;
  accountHolder: string | null;
  accountReference: string | null;
}

export interface Event {
  id: string;
  /** Conta proprietária; nulo em eventos legados geridos por link. */
  hostId: string | null;
  title: string;
  hostName: string;
  hostEmail: string;
  category: EventCategory | null;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  location: EventLocation;
  message: string | null;
  rules: string | null;
  dressCode: string | null;
  templateId: string | null;
  theme: EventTheme;
  contribution: EventContribution;
  /** Imagem de capa (upload ou URL); `null` usa a arte do template. */
  coverUrl: string | null;
  /** SHA-256 do último ficheiro carregado, para uploads idempotentes. */
  coverHash: string | null;
  /** `public_id` no Cloudinary, para remover o asset ao substituir. */
  coverPublicId: string | null;
  rsvpDeadline: Date | null;
  status: EventStatus;
  /** Campos de cancelamento (preenchidos por anfitrião ou super admin). */
  cancelledAt: Date | null;
  cancelledReason: string | null;
  cancelledBy: string | null;
  manageTokenExpiresAt: Date | null;
  manageTokenRevokedAt: Date | null;
  visibility: EventVisibility;
  /** Slug aleatório do link público; gerado ao tornar o evento público. */
  publicSlug: string | null;
  /** O nº de confirmados só é público quando o anfitrião o permite. */
  showAttendeeCount: boolean;
  /** Limites de idade: internos, nunca expostos em respostas públicas. */
  minAge: number | null;
  maxAge: number | null;
  /** Remoção lógica: eventos removidos deixam de ser encontrados. */
  deletedAt: Date | null;
  /** Comunidade do evento (Bloco 11); `null` = evento pessoal. */
  communityId: string | null;
  /** Bloco 14: só o ID do vídeo (11 caracteres), nunca o URL. */
  youtubeVideoId?: string | null;
  /** Bloco 14: mesas ativas (o PDF só mostra a mesa quando `true`). */
  useTables?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Registo interno: inclui o hash do segredo de gestão. */
export interface EventRecord extends Event {
  manageTokenHash: string;
}

export interface CreateEventInput {
  hostId: string | null;
  title: string;
  hostName: string;
  hostEmail: string;
  category: EventCategory | null;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  location: EventLocation;
  message: string | null;
  rules: string | null;
  dressCode: string | null;
  templateId: string | null;
  theme: EventTheme;
  contribution: EventContribution;
  rsvpDeadline: Date | null;
  /** Capa opcional na criação ou através dos endpoints dedicados. */
  coverUrl?: string | null;
  coverHash?: string | null;
  coverPublicId?: string | null;
  visibility?: EventVisibility;
  publicSlug?: string | null;
  showAttendeeCount?: boolean;
  minAge?: number | null;
  maxAge?: number | null;
  communityId?: string | null;
  youtubeVideoId?: string | null;
  useTables?: boolean;
}

export type UpdateEventInput = Partial<CreateEventInput> & {
  status?: EventStatus;
};

export interface EventStats {
  totalInvitations: number;
  accepted: number;
  declined: number;
  pending: number;
}

export interface EventWithStats extends EventRecord {
  stats: EventStats;
  accessRole: EventAccessRole;
}

/** Conta/gestor que pode aceder ao evento: proprietário ou gestor por email. */
export interface EventAccessScope {
  hostId: string;
  /** Email verificado da conta; `null` quando não pode gerir por email. */
  managerEmail: string | null;
}

export interface EventAccessRecord {
  event: EventRecord;
  accessRole: EventAccessRole;
}

export interface HostEventListFilters {
  hostId: string;
  managerEmail: string | null;
  status?: EventStatus;
  q?: string;
  sort: 'starts_at' | 'created_at';
  order: 'asc' | 'desc';
  offset: number;
  limit: number;
}

export interface HostTotals {
  events: number;
  drafts: number;
  scheduled: number;
  cancelled: number;
  completed: number;
  totalInvitations: number;
  accepted: number;
  declined: number;
  pending: number;
}

export interface EventReportRow {
  eventId: string;
  title: string;
  status: EventStatus;
  /** Data do evento, usada apenas no PDF; não faz parte do contrato da API. */
  startsAt?: Date | null;
  totalInvitations: number;
  accepted: number;
  declined: number;
  pending: number;
}

export interface DailyReportRow {
  date: string;
  invitations: number;
  accepted: number;
  declined: number;
  reminders: number;
}

/** Movimento de um evento dentro de um intervalo de datas (dias UTC). */
export interface EventPeriodActivity {
  invitationsCreated: number;
  accepted: number;
  declined: number;
  pendingCreated: number;
  remindersSent: number;
}

/**
 * Relatório de um único evento num período.
 *
 * `activity` descreve o que aconteceu no intervalo; `current` é o
 * retrato atual de todos os convites do evento, para que o leitor não
 * confunda o movimento do período com o total acumulado.
 */
export interface EventPeriodReport {
  event: EventRecord;
  period: { from: string; to: string };
  activity: EventPeriodActivity;
  current: EventStats;
  daily: DailyReportRow[];
}
