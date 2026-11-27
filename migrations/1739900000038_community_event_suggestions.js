/**
 * Sugestões de eventos de comunidade.
 *
 * Qualquer membro activo (incluindo responsável e gestores) sugere um
 * evento; a aprovação é de gestores/responsável. Na aprovação, o autor
 * da sugestão passa a ser o anfitrião (`host_id`) do evento criado.
 *
 * Não há índice único por par: um membro pode ter várias sugestões
 * pendentes ao mesmo tempo. O `event_id` só é preenchido em sugestões
 * aprovadas e fica nulo se o evento for apagado.
 *
 * Reversível: `down` repõe o CHECK de auditoria anterior e remove a
 * tabela (o evento criado não é apagado).
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

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS community_event_suggestions (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      host_id      uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      title        text NOT NULL,
      payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
      message      text,
      status       text NOT NULL DEFAULT 'pending',
      decided_by   uuid REFERENCES hosts(id) ON DELETE SET NULL,
      decided_at   timestamptz,
      event_id     uuid REFERENCES events(id) ON DELETE SET NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT community_event_suggestions_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      CONSTRAINT community_event_suggestions_title_check
        CHECK (char_length(btrim(title)) BETWEEN 2 AND 150),
      CONSTRAINT community_event_suggestions_message_check
        CHECK (message IS NULL OR char_length(message) <= 500),
      CONSTRAINT community_event_suggestions_payload_check
        CHECK (pg_column_size(payload) <= 65536),
      CONSTRAINT community_event_suggestions_event_check
        CHECK (event_id IS NULL OR status = 'approved'),
      CONSTRAINT community_event_suggestions_decision_check
        CHECK ((status = 'pending') = (decided_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS community_event_suggestions_community_idx
      ON community_event_suggestions (community_id, status, created_at);
    CREATE INDEX IF NOT EXISTS community_event_suggestions_host_idx
      ON community_event_suggestions (host_id, status, created_at DESC);

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
      CHECK (action IN (${AUDIT_BASE}, ${AUDIT_INSTITUTION}, ${AUDIT_SUGGESTION}));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_audit_log WHERE action IN (${AUDIT_SUGGESTION});
    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
      CHECK (action IN (${AUDIT_BASE}, ${AUDIT_INSTITUTION}));

    DROP TABLE IF EXISTS community_event_suggestions;
  `);
};
