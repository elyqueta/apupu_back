/**
 * Bloco 11 — comunidades e equipas reutilizáveis.
 *
 * - `communities`, `community_members` (um `owner` activo por comunidade),
 *   `community_join_requests` (um pedido pendente por par) e
 *   `community_ownership_transfers` (OTP reutiliza `registration_verifications`
 *   com `purpose = 'community_transfer'`; aqui só fica o estado).
 * - `events.community_id` opcional: um evento pode existir sem comunidade.
 * - Equipas: o criador é `teams.created_by_host_id` (já existia; backfill com
 *   o anfitrião do evento quando estava vazio). `teams.community_id` opcional.
 *   Nova tabela `team_events` com backfill do `event_id` actual; `teams.event_id`
 *   mantém-se como evento principal (legado, leitura).
 * - `invitations.referrer_member_id` para a partilha rastreada (`?ref=`).
 * - Novos tipos de email (`community_notice`) e acções de auditoria.
 *
 * Não destrutiva: nenhuma equipa perde o evento. `down` remove só o que foi
 * acrescentado (o backfill de `created_by_host_id` mantém-se: era nulo e o
 * valor preenchido é o anfitrião do próprio evento).
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
  'support_message_resolved', 'newsletter_subscription_removed'
`;

const AUDIT_COMMUNITY = `
  'community_created', 'community_updated', 'community_deleted',
  'community_member_invited', 'community_member_removed', 'community_member_left',
  'community_role_changed', 'community_join_decided',
  'community_transfer_started', 'community_transfer_completed',
  'community_transfer_cancelled', 'team_events_changed', 'team_left'
`;

const EMAIL_BASE = `
  'manage_link', 'manager_invite', 'invitation', 'reminder',
  'decline_notification', 'event_cancelled', 'invitation_removed',
  'email_verification', 'registration_otp', 'host_welcome',
  'password_reset', 'profile_reminder',
  'team_invite', 'team_added', 'team_role_changed',
  'task_assigned', 'task_completed', 'task_reassigned',
  'member_removed', 'invitation_reply'
`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS communities (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name             text NOT NULL,
      slug             text NOT NULL,
      description      text,
      visibility       text NOT NULL DEFAULT 'private',
      owner_id         uuid NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
      avatar_url       text,
      avatar_public_id text,
      cover_url        text,
      cover_public_id  text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      deleted_at       timestamptz,
      CONSTRAINT communities_name_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
      CONSTRAINT communities_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
      CONSTRAINT communities_visibility_check CHECK (visibility IN ('public', 'private'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS communities_slug_uidx ON communities (slug);
    CREATE INDEX IF NOT EXISTS communities_owner_idx ON communities (owner_id) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS community_members (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      host_id       uuid REFERENCES hosts(id) ON DELETE SET NULL,
      email         citext,
      phone         text,
      display_name  text,
      role          text NOT NULL DEFAULT 'member',
      status        text NOT NULL DEFAULT 'invited',
      ref_code      text NOT NULL,
      invited_by    uuid REFERENCES hosts(id) ON DELETE SET NULL,
      joined_at     timestamptz,
      left_at       timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT community_members_role_check CHECK (role IN ('owner', 'manager', 'member')),
      CONSTRAINT community_members_status_check CHECK (status IN ('active', 'invited', 'left', 'removed')),
      CONSTRAINT community_members_contact_check CHECK (host_id IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL),
      CONSTRAINT community_members_ref_code_check CHECK (ref_code ~ '^[A-Za-z0-9_-]{6,32}$')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS community_members_one_owner
      ON community_members (community_id) WHERE role = 'owner' AND status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS community_members_host_uidx
      ON community_members (community_id, host_id)
      WHERE host_id IS NOT NULL AND status IN ('active', 'invited');
    CREATE UNIQUE INDEX IF NOT EXISTS community_members_email_uidx
      ON community_members (community_id, email)
      WHERE email IS NOT NULL AND status IN ('active', 'invited');
    CREATE UNIQUE INDEX IF NOT EXISTS community_members_ref_code_uidx ON community_members (ref_code);
    CREATE INDEX IF NOT EXISTS community_members_host_idx ON community_members (host_id) WHERE host_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS community_join_requests (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      host_id       uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      message       text,
      status        text NOT NULL DEFAULT 'pending',
      decided_by    uuid REFERENCES hosts(id) ON DELETE SET NULL,
      decided_at    timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT community_join_requests_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      CONSTRAINT community_join_requests_message_check
        CHECK (message IS NULL OR char_length(message) <= 500)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS community_join_requests_pending_uidx
      ON community_join_requests (community_id, host_id) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS community_ownership_transfers (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id   uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      from_host_id   uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      to_host_id     uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      otp_expires_at timestamptz,
      attempts       integer NOT NULL DEFAULT 0,
      status         text NOT NULL DEFAULT 'pending_otp',
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      completed_at   timestamptz,
      CONSTRAINT community_transfers_status_check CHECK (
        status IN ('pending_otp', 'pending_accept', 'completed', 'cancelled', 'expired')
      ),
      CONSTRAINT community_transfers_distinct_check CHECK (from_host_id <> to_host_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS community_transfers_open_uidx
      ON community_ownership_transfers (community_id)
      WHERE status IN ('pending_otp', 'pending_accept');

    ALTER TABLE events
      ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES communities(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS events_community_idx
      ON events (community_id) WHERE community_id IS NOT NULL AND deleted_at IS NULL;

    UPDATE teams t
       SET created_by_host_id = e.host_id
      FROM events e
     WHERE e.id = t.event_id
       AND t.created_by_host_id IS NULL
       AND e.host_id IS NOT NULL;

    ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES communities(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS team_events (
      team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (team_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS team_events_event_idx ON team_events (event_id);

    INSERT INTO team_events (team_id, event_id, created_at)
    SELECT id, event_id, created_at FROM teams
    ON CONFLICT DO NOTHING;

    ALTER TABLE invitations
      ADD COLUMN IF NOT EXISTS referrer_member_id uuid REFERENCES community_members(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS invitations_referrer_idx
      ON invitations (referrer_member_id) WHERE referrer_member_id IS NOT NULL;

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (${AUDIT_BASE}, ${AUDIT_COMMUNITY}));

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (message_type IN (${EMAIL_BASE}, 'community_notice'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM email_deliveries WHERE message_type = 'community_notice';
    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (message_type IN (${EMAIL_BASE}));

    DELETE FROM host_audit_log WHERE action IN (${AUDIT_COMMUNITY});
    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (${AUDIT_BASE}));

    DROP INDEX IF EXISTS invitations_referrer_idx;
    ALTER TABLE invitations DROP COLUMN IF EXISTS referrer_member_id;

    DROP TABLE IF EXISTS team_events;
    ALTER TABLE teams DROP COLUMN IF EXISTS community_id;

    DROP INDEX IF EXISTS events_community_idx;
    ALTER TABLE events DROP COLUMN IF EXISTS community_id;

    DROP TABLE IF EXISTS community_ownership_transfers;
    DROP TABLE IF EXISTS community_join_requests;
    DROP TABLE IF EXISTS community_members;
    DROP TABLE IF EXISTS communities;
  `);
};
