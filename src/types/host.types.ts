/** Tipos de conta de anfitrião, perfil e sessões de autenticação. */

export const HOST_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type HostStatus = (typeof HOST_STATUSES)[number];

export const HOST_LOCALES = ['pt-AO', 'en'] as const;
export type HostLocale = (typeof HOST_LOCALES)[number];

export interface HostProfile {
  hostId: string;
  displayName: string | null;
  phone: string | null;
  /** Data de calendário `YYYY-MM-DD`; nunca convertida para instante. */
  birthDate: string | null;
  locale: HostLocale;
  timezone: string;
  avatarUrl: string | null;
  /** SHA-256 do último ficheiro de avatar enviado; evita uploads repetidos. */
  avatarHash: string | null;
  /** Identificador no Cloudinary, usado para remover o asset antigo. */
  avatarPublicId: string | null;
  /** Imagem de capa do perfil, definida por URL ou upload. */
  coverUrl: string | null;
  /** SHA-256 do último ficheiro enviado; permite upload idempotente. */
  coverHash: string | null;
  /** Identificador no Cloudinary, usado para remover o asset antigo. */
  coverPublicId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostAccount {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  /** Papel `super_admin` do Bloco 6; promoção apenas por SQL. */
  isSuperAdmin: boolean;
  status: HostStatus;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Conta com perfil, forma usada pela maioria dos serviços. */
export interface HostWithProfile extends HostAccount {
  profile: HostProfile;
}

/**
 * Contacto seguro para a página pública do convite.
 *
 * Nunca inclui `birth_date`, localização, preferências nem qualquer
 * outro dado do perfil: só nome/email do evento e telefone/avatar do
 * perfil verificado.
 */
export interface HostPublicContact {
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
}

export interface CreateHostInput {
  email: string;
  passwordHash: string;
  displayName: string | null;
}

export interface UpdateHostProfileInput {
  displayName?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  locale?: HostLocale;
  timezone?: string;
  avatarUrl?: string | null;
  avatarHash?: string | null;
  avatarPublicId?: string | null;
  coverUrl?: string | null;
  coverHash?: string | null;
  coverPublicId?: string | null;
}

export interface HostAuthSession {
  id: string;
  hostId: string;
  tokenHash: string;
  csrfHash: string;
  userAgentHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export const ACTIVITY_KINDS = [
  'rsvp_accepted',
  'rsvp_declined',
  'guest_added',
  'reminder_sent',
  'event_created',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface EventActivity {
  id: string;
  eventId: string;
  invitationId: string | null;
  kind: ActivityKind;
  guestName: string | null;
  metadata: Record<string, unknown>;
  at: Date;
}

export interface EventActivityWithEvent extends EventActivity {
  eventTitle: string;
}

/** Notificações in-app: actividades, lembretes e tarefas. */
export const NOTIFICATION_KINDS = [
  'rsvp_accepted',
  'rsvp_declined',
  'guest_added',
  'reminder_sent',
  'event_created',
  'event_upcoming',
  'rsvp_deadline',
  'task_assigned',
  'task_completed',
  'task_reassigned',
  'team_added',
  'role_changed',
  'access_suspicious',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ['all', 'unread', 'read'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface HostNotification {
  id: string;
  hostId: string;
  eventId: string | null;
  eventTitle: string | null;
  activityId: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface HostTask {
  id: string;
  hostId: string;
  eventId: string | null;
  eventTitle: string | null;
  managerId: string | null;
  managerEmail: string | null;
  label: string;
  done: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
