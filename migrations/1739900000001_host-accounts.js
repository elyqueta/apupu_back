/**
 * Contas de anfitrião, perfil, sessões de conta e suporte ao frontend.
 *
 * - `hosts` / `host_profiles`: identidade e perfil (data de nascimento
 *   opcional, preenchida depois).
 * - `host_auth_sessions`: sessões de conta, distintas das sessões de
 *   gestão por evento (que passam a chamar-se `event_host_sessions`).
 * - `email_verifications` / `password_resets`: tokens de uso único,
 *   guardados apenas como HMAC.
 * - `event_activity`: feed de actividade por evento.
 * - `host_tasks`: tarefas do workspace do anfitrião.
 * - `events.host_id` liga eventos à conta; nulo em eventos legados.
 * - `events.category` e `invitations.table_name` suportam os campos
 *   usados pelo frontend.
 * - `email_deliveries` passa a suportar mensagens de conta (sem evento)
 *   e guarda o token cifrado necessário para renderizar verificação e
 *   reposição de senha no worker.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS citext;

    CREATE TABLE hosts (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email                  citext NOT NULL,
      password_hash          text NOT NULL,
      email_verified_at      timestamptz,
      status                 text NOT NULL DEFAULT 'active',
      failed_login_attempts  integer NOT NULL DEFAULT 0,
      locked_until           timestamptz,
      last_login_at          timestamptz,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT hosts_email_unique UNIQUE (email),
      CONSTRAINT hosts_status_check CHECK (status IN ('active', 'suspended', 'deleted')),
      CONSTRAINT hosts_failed_login_attempts_check CHECK (failed_login_attempts >= 0)
    );

    CREATE INDEX hosts_status_idx ON hosts (status);

    CREATE TABLE host_profiles (
      host_id      uuid PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      display_name text,
      phone        text,
      birth_date   date,
      locale       text NOT NULL DEFAULT 'pt-AO',
      timezone     text NOT NULL DEFAULT 'Africa/Luanda',
      avatar_url   text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT host_profiles_locale_check CHECK (locale IN ('pt-AO', 'en')),
      CONSTRAINT host_profiles_birth_date_check CHECK (
        birth_date IS NULL OR birth_date < current_date
      )
    );

    CREATE TABLE host_auth_sessions (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id         uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      token_hash      text NOT NULL UNIQUE,
      csrf_hash       text NOT NULL,
      user_agent_hash text,
      expires_at      timestamptz NOT NULL,
      revoked_at      timestamptz,
      last_used_at    timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT host_auth_sessions_expiry_check CHECK (expires_at > created_at)
    );

    CREATE INDEX host_auth_sessions_host_id_idx ON host_auth_sessions (host_id);
    CREATE INDEX host_auth_sessions_expiry_idx ON host_auth_sessions (expires_at);

    CREATE TABLE email_verifications (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id     uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      token_hash  text NOT NULL UNIQUE,
      expires_at  timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX email_verifications_host_id_idx ON email_verifications (host_id);
    CREATE INDEX email_verifications_expiry_idx ON email_verifications (expires_at);

    CREATE TABLE password_resets (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id     uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      token_hash  text NOT NULL UNIQUE,
      expires_at  timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX password_resets_host_id_idx ON password_resets (host_id);
    CREATE INDEX password_resets_expiry_idx ON password_resets (expires_at);

    ALTER TABLE events
      ADD COLUMN host_id uuid REFERENCES hosts(id) ON DELETE SET NULL,
      ADD COLUMN category text;

    ALTER TABLE events
      ADD CONSTRAINT events_category_check CHECK (
        category IS NULL
        OR category IN ('wedding', 'birthday', 'corporate', 'baby', 'other')
      );

    CREATE INDEX events_host_id_idx ON events (host_id);

    ALTER TABLE invitations ADD COLUMN table_name text;

    ALTER TABLE host_sessions RENAME TO event_host_sessions;
    ALTER INDEX host_sessions_event_id_idx RENAME TO event_host_sessions_event_id_idx;
    ALTER INDEX host_sessions_expiry_idx RENAME TO event_host_sessions_expiry_idx;
    ALTER TABLE event_host_sessions
      RENAME CONSTRAINT host_sessions_expiry_check TO event_host_sessions_expiry_check;

    CREATE TABLE event_activity (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      invitation_id uuid REFERENCES invitations(id) ON DELETE SET NULL,
      kind          text NOT NULL,
      guest_name    text,
      metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
      at            timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT event_activity_kind_check CHECK (
        kind IN (
          'rsvp_accepted', 'rsvp_declined', 'guest_added',
          'reminder_sent', 'event_created'
        )
      )
    );

    CREATE INDEX event_activity_event_id_idx ON event_activity (event_id, at DESC);
    CREATE INDEX event_activity_at_idx ON event_activity (at DESC);

    CREATE TABLE host_tasks (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id    uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      event_id   uuid REFERENCES events(id) ON DELETE CASCADE,
      label      text NOT NULL,
      done       boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX host_tasks_host_id_idx ON host_tasks (host_id, created_at DESC);
    CREATE INDEX host_tasks_event_id_idx ON host_tasks (event_id);

    ALTER TABLE email_deliveries
      ALTER COLUMN event_id DROP NOT NULL,
      ADD COLUMN host_id uuid REFERENCES hosts(id) ON DELETE CASCADE,
      ADD COLUMN token_encrypted text;

    ALTER TABLE email_deliveries DROP CONSTRAINT email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'invitation', 'reminder', 'decline_notification',
          'event_cancelled', 'email_verification', 'host_welcome',
          'password_reset', 'profile_reminder'
        )
      );

    CREATE INDEX email_deliveries_host_id_idx ON email_deliveries (host_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS email_deliveries_host_id_idx;
    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'invitation', 'reminder', 'decline_notification', 'event_cancelled'
        )
      );
    ALTER TABLE email_deliveries
      DROP COLUMN IF EXISTS token_encrypted,
      DROP COLUMN IF EXISTS host_id;
    DELETE FROM email_deliveries WHERE event_id IS NULL;
    ALTER TABLE email_deliveries ALTER COLUMN event_id SET NOT NULL;

    DROP TABLE IF EXISTS host_tasks;
    DROP TABLE IF EXISTS event_activity;

    ALTER TABLE event_host_sessions
      RENAME CONSTRAINT event_host_sessions_expiry_check TO host_sessions_expiry_check;
    ALTER INDEX event_host_sessions_expiry_idx RENAME TO host_sessions_expiry_idx;
    ALTER INDEX event_host_sessions_event_id_idx RENAME TO host_sessions_event_id_idx;
    ALTER TABLE event_host_sessions RENAME TO host_sessions;

    ALTER TABLE invitations DROP COLUMN IF EXISTS table_name;

    DROP INDEX IF EXISTS events_host_id_idx;
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_category_check;
    ALTER TABLE events
      DROP COLUMN IF EXISTS category,
      DROP COLUMN IF EXISTS host_id;

    DROP TABLE IF EXISTS password_resets;
    DROP TABLE IF EXISTS email_verifications;
    DROP TABLE IF EXISTS host_auth_sessions;
    DROP TABLE IF EXISTS host_profiles;
    DROP TABLE IF EXISTS hosts;
  `);
};
