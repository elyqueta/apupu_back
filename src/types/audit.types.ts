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
  'event_cancelled',
  'event_cancel_otp_requested',
  'admin_event_cancelled',
  'guest_added',
  'guest_updated',
  'guest_deleted',
  'guest_invitation_resent',
  'guest_whatsapp_shared',
  'guest_access_revoked',
  'manage_link_rotated',
  'manage_link_resent',
  'manager_added',
  'manager_removed',
  'manager_invite_resent',
  'manager_link_used',
  'event_cover_updated',
  'event_cover_removed',
  'activity_deleted',
  // Bloco 7: auditoria das acções administrativas sobre apoio e novidades.
  // A constraint CHECK de host_audit_log é alargada na migração 0023.
  'support_message_resolved',
  'newsletter_subscription_removed',
  // Bloco 11: comunidades e equipas reutilizáveis (CHECK alargado na migração 0029).
  'community_created',
  'community_updated',
  'community_deleted',
  'community_member_invited',
  'community_member_removed',
  'community_member_left',
  'community_role_changed',
  'community_join_decided',
  'community_transfer_started',
  'community_transfer_completed',
  'community_transfer_cancelled',
  'team_events_changed',
  'team_left',
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
