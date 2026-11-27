/**
 * Feed de actividade da comunidade (acção "Partilhar" do feed).
 *
 * Cada partilha liga a conta ao evento na comunidade; repetir a
 * partilha do mesmo par não cria outra entrada (`ON CONFLICT DO NOTHING`).
 * Um evento apagado remove a entrada, mas o histórico da comunidade fica.
 *
 * Reversível: `down` repõe o CHECK de auditoria anterior e remove a
 * tabela.
 */
const AUDIT_BASE = `
  'login_success', 'login_failure', 'login_locked',
  'registration_code_requested', 'registration_code_verified',
  'registration_code_failed', 'registration_completed',
  'email_verified',
  'password_changed', 'password_reset',
  'profile_updated',
  'event_created', 'event_deleted',
  'guest_added', 'guest_updated', 'guest_deleted',
  'guest_invitation_resent', 'guest_access_revoked',
  'guest_whatsapp_shared',
  'manage_link_rotated', 'manage_link_resent',
  'manager_added', 'manager_removed', 'manager_invite_resent',
  'manager_link_used', 'manager_access_suspicious',
  'support_message_resolved', 'newsletter_subscription_removed',
  'community_created', 'community_updated', 'community_deleted',
  'community_member_invited', 'community_member_removed', 'community_member_left',
  'community_role_changed', 'community_join_decided',
  'community_transfer_started', 'community_transfer_completed',
  'community_transfer_cancelled', 'team_events_changed', 'team_left'
`;

const AUDIT_INSTITUTION = `
  'institution_created', 'institution_updated', 'institution_deleted',
  'institution_link_requested', 'institution_link_approved', 'institution_link_rejected',
  'institution_community_removed', 'institution_community_left'
`;

const AUDIT_SUGGESTION = `
  'community_event_suggested', 'community_event_suggestion_decided',
  'community_event_suggestion_cancelled'
`;

const AUDIT_ACTIVITY = `'community_activity_shared'`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS community_activity (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      host_id      uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT community_activity_uidx UNIQUE (community_id, host_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS community_activity_community_created_idx
      ON community_activity (community_id, created_at DESC);

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
      CHECK (action IN (${AUDIT_BASE}, ${AUDIT_INSTITUTION}, ${AUDIT_SUGGESTION}, ${AUDIT_ACTIVITY}));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_audit_log WHERE action IN (${AUDIT_ACTIVITY});
    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
      CHECK (action IN (${AUDIT_BASE}, ${AUDIT_INSTITUTION}, ${AUDIT_SUGGESTION}));

    DROP TABLE IF EXISTS community_activity;
  `);
};
