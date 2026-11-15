/** Tipos do domínio de eventos. */

export const EVENT_STATUSES = ['draft', 'scheduled', 'cancelled', 'completed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

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
  rsvpDeadline: Date | null;
  status: EventStatus;
  manageTokenExpiresAt: Date | null;
  manageTokenRevokedAt: Date | null;
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
}

export interface HostEventListFilters {
  hostId: string;
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
