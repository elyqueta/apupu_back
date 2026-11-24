/**
 * Bloco 13 — instituições (modelo base).
 *
 * - `institutions`: só o criador administra (sem administradores extra).
 * - `communities.institution_id`: uma comunidade pertence no máximo a uma
 *   instituição (coluna única por comunidade = restrição na própria BD).
 * - `institution_community_requests`: pedidos nos dois sentidos; nenhuma
 *   ligação ou remoção acontece sem OTP do criador da instituição (o OTP
 *   vive em `registration_verifications`, `purpose = 'institution_link'`).
 * - Acções de auditoria novas.
 *
 * Reversível: `down` remove só o que foi acrescentado.
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

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS institutions (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name             text NOT NULL,
      slug             text NOT NULL,
      description      text,
      visibility       text NOT NULL DEFAULT 'private',
      creator_id       uuid NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
      avatar_url       text,
      avatar_public_id text,
      cover_url        text,
      cover_public_id  text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      deleted_at       timestamptz,
      CONSTRAINT institutions_name_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
      CONSTRAINT institutions_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
      CONSTRAINT institutions_visibility_check CHECK (visibility IN ('public', 'private'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS institutions_slug_uidx ON institutions (slug);
    CREATE INDEX IF NOT EXISTS institutions_creator_idx ON institutions (creator_id) WHERE deleted_at IS NULL;

    ALTER TABLE communities
      ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS communities_institution_idx
      ON communities (institution_id) WHERE institution_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS institution_community_requests (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id  uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      community_id    uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      direction       text NOT NULL,
      kind            text NOT NULL DEFAULT 'link',
      status          text NOT NULL DEFAULT 'pending',
      requested_by    uuid REFERENCES hosts(id) ON DELETE SET NULL,
      community_accepted_at timestamptz,
      otp_expires_at  timestamptz,
      decided_by      uuid REFERENCES hosts(id) ON DELETE SET NULL,
      decided_at      timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT institution_requests_direction_check
        CHECK (direction IN ('community_to_institution', 'institution_to_community')),
      CONSTRAINT institution_requests_kind_check CHECK (kind IN ('link', 'remove')),
      CONSTRAINT institution_requests_status_check
        CHECK (status IN ('pending', 'awaiting_otp', 'approved', 'rejected', 'cancelled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS institution_requests_open_uidx
      ON institution_community_requests (institution_id, community_id)
      WHERE status IN ('pending', 'awaiting_otp');

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (${AUDIT_BASE}, ${AUDIT_INSTITUTION}));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_audit_log WHERE action IN (${AUDIT_INSTITUTION});
    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (${AUDIT_BASE}));

    DROP TABLE IF EXISTS institution_community_requests;
    DROP INDEX IF EXISTS communities_institution_idx;
    ALTER TABLE communities DROP COLUMN IF EXISTS institution_id;
    DROP TABLE IF EXISTS institutions;
  `);
};
