/** Tipos da auditoria de eventos críticos. */

export const AUDIT_ACTIONS = [
  'login_success',
  'login_failure',
  'login_locked',
  'registration_code_requested',
  'registration_code_verified',
  'registration_code_failed',
  'registration_completed',
  'email_verified',
  'password_changed',
  'password_reset',
  'profile_updated',
  'event_created',
  'event_deleted',
  'guest_added',
  'guest_updated',
  'guest_deleted',
  'guest_invitation_resent',
  'guest_access_revoked',
  'manage_link_rotated',
  'manage_link_resent',
  'manager_added',
  'manager_removed',
  'manager_invite_resent',
  'manager_link_used',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['success', 'failure'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditEntry {
  hostId?: string | null;
  eventId?: string | null;
  action: AuditAction;
  outcome?: AuditOutcome;
  ip?: string | null;
  requestId?: string | null;
  /** Apenas contagens e nomes de campos; nunca PII, tokens ou senhas. */
  metadata?: Record<string, unknown>;
}

export interface HostAuditLog extends AuditEntry {
  id: string;
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
  at: Date;
}
