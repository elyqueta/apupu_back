/**
 * Esquema inicial do Apupu.
 *
 * Decisões de segurança e integridade:
 * - `events.manage_token_hash` e `invitations.token_hash` guardam
 *   apenas o HMAC do token. O token em claro só existe no link
 *   entregue por email.
 * - `invitations.token_encrypted` guarda o token cifrado com
 *   AES-256-GCM, para reenvios e lembretes. O hash serve só para
 *   lookup.
 * - `invitations.claim_hash` liga o convite ao primeiro navegador que
 *   o abriu. Não identifica uma pessoa nem hardware.
 * - `email_deliveries` é a outbox: a chave `idempotency_key` impede
 *   que reexecutar o scheduler ou repetir um pedido crie envios
 *   duplicados.
 * - `host_sessions` permite trocar o segredo de gestão por um cookie
 *   HttpOnly de curta duração, sem voltar a expor o segredo.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE event_templates (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug              text NOT NULL UNIQUE,
      name              text NOT NULL,
      description       text,
      preview_image_url text,
      supported_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,
      themes            jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_active         boolean NOT NULL DEFAULT true,
      sort_order        integer NOT NULL DEFAULT 0,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE events (
      id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      manage_token_hash             text NOT NULL UNIQUE,
      manage_token_expires_at       timestamptz,
      manage_token_revoked_at       timestamptz,
      title                         text NOT NULL,
      host_name                     text NOT NULL,
      host_email                    text NOT NULL,
      starts_at                     timestamptz NOT NULL,
      ends_at                       timestamptz,
      timezone                      text NOT NULL DEFAULT 'Africa/Luanda',
      location_type                 text NOT NULL DEFAULT 'venue',
      location_name                 text,
      location_address              text,
      online_url                    text,
      message                       text,
      rules                         text,
      dress_code                    text,
      template_id                   uuid REFERENCES event_templates(id) ON DELETE SET NULL,
      theme                         jsonb NOT NULL DEFAULT '{}'::jsonb,
      contribution_enabled          boolean NOT NULL DEFAULT false,
      contribution_bank_name        text,
      contribution_account_holder   text,
      contribution_account_reference text,
      rsvp_deadline                 timestamptz,
      status                        text NOT NULL DEFAULT 'scheduled',
      created_at                    timestamptz NOT NULL DEFAULT now(),
      updated_at                    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT events_status_check CHECK (
        status IN ('draft', 'scheduled', 'cancelled', 'completed')
      ),
      CONSTRAINT events_location_type_check CHECK (location_type IN ('venue', 'online')),
      CONSTRAINT events_location_check CHECK (
        (location_type = 'venue' AND location_name IS NOT NULL)
        OR (location_type = 'online' AND online_url IS NOT NULL)
      ),
      CONSTRAINT events_contribution_check CHECK (
        contribution_enabled = false
        OR (
          contribution_bank_name IS NOT NULL
          AND contribution_account_holder IS NOT NULL
          AND contribution_account_reference IS NOT NULL
        )
      ),
      CONSTRAINT events_dates_check CHECK (ends_at IS NULL OR ends_at > starts_at)
    );

    CREATE INDEX events_starts_at_idx ON events (starts_at);
    CREATE INDEX events_status_idx ON events (status);

    CREATE TABLE invitations (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id            uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guest_name          text NOT NULL,
      guest_email         text NOT NULL,
      guest_phone         text,
      token_hash          text NOT NULL UNIQUE,
      token_encrypted     text NOT NULL,
      claim_hash          text,
      claimed_at          timestamptz,
      claim_revoked_at    timestamptz,
      rsvp_status         text NOT NULL DEFAULT 'pending',
      rsvp_responded_at   timestamptz,
      rsvp_version        integer NOT NULL DEFAULT 0,
      send_status         text NOT NULL DEFAULT 'pending',
      send_count          integer NOT NULL DEFAULT 0,
      last_sent_at        timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT invitations_rsvp_status_check CHECK (
        rsvp_status IN ('pending', 'accepted', 'declined')
      ),
      CONSTRAINT invitations_send_status_check CHECK (
        send_status IN ('pending', 'queued', 'sent', 'failed')
      ),
      CONSTRAINT invitations_event_email_unique UNIQUE (event_id, guest_email)
    );

    CREATE INDEX invitations_event_id_idx ON invitations (event_id);
    CREATE INDEX invitations_rsvp_status_idx ON invitations (event_id, rsvp_status);
    CREATE INDEX invitations_send_status_idx ON invitations (event_id, send_status);

    CREATE TABLE host_sessions (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token_hash        text NOT NULL UNIQUE,
      expires_at        timestamptz NOT NULL,
      revoked_at        timestamptz,
      created_at        timestamptz NOT NULL DEFAULT now(),
      last_used_at      timestamptz,
      CONSTRAINT host_sessions_expiry_check CHECK (expires_at > created_at)
    );

    CREATE INDEX host_sessions_event_id_idx ON host_sessions (event_id);
    CREATE INDEX host_sessions_expiry_idx ON host_sessions (expires_at);

    CREATE TABLE email_deliveries (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      invitation_id     uuid REFERENCES invitations(id) ON DELETE CASCADE,
      message_type      text NOT NULL,
      reminder_kind     text,
      recipient_email   text NOT NULL,
      scheduled_for     timestamptz NOT NULL DEFAULT now(),
      status            text NOT NULL DEFAULT 'pending',
      attempts          integer NOT NULL DEFAULT 0,
      next_attempt_at   timestamptz,
      provider_message_id text,
      last_error        text,
      idempotency_key   text NOT NULL UNIQUE,
      sent_at           timestamptz,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'invitation', 'reminder', 'decline_notification', 'event_cancelled'
        )
      ),
      CONSTRAINT email_deliveries_status_check CHECK (
        status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')
      ),
      CONSTRAINT email_deliveries_attempts_check CHECK (attempts >= 0)
    );

    CREATE INDEX email_deliveries_due_idx
      ON email_deliveries (status, scheduled_for)
      WHERE status = 'pending';
    CREATE INDEX email_deliveries_event_id_idx ON email_deliveries (event_id);
    CREATE INDEX email_deliveries_invitation_id_idx ON email_deliveries (invitation_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS email_deliveries;
    DROP TABLE IF EXISTS host_sessions;
    DROP TABLE IF EXISTS invitations;
    DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS event_templates;
  `);
};
