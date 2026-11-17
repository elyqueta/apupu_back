/**
 * Gestores de evento.
 *
 * - `event_managers` guarda um gestor por email e evento. O gestor não
 *   precisa de conta: recebe um link próprio (hash HMAC) e entra na
 *   mesma área de gestão por link. Quando cria conta com o mesmo email
 *   verificado, passa também a ver o evento no workspace.
 * - `event_host_sessions` ganha `role` e `manager_id`: as sessões
 *   antigas continuam a ser de anfitrião (`host`), sem migração de
 *   dados.
 * - A outbox passa a suportar `manager_invite` e a auditoria regista
 *   as operações de gestão de gestores.
 *
 * A remoção de um gestor é lógica (`revoked_at`), para permitir
 * reativar o mesmo email sem duplicar a linha. O token em claro nunca
 * é persistido: a tabela guarda apenas o HMAC e a outbox uma cópia
 * cifrada até o worker renderizar o email.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE event_managers (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      email            citext NOT NULL,
      token_hash       text UNIQUE,
      token_expires_at timestamptz,
      revoked_at       timestamptz,
      last_used_at     timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT event_managers_event_email_unique UNIQUE (event_id, email)
    );

    CREATE INDEX event_managers_event_id_idx ON event_managers (event_id);
    CREATE INDEX event_managers_email_idx ON event_managers (email);

    ALTER TABLE event_host_sessions
      ADD COLUMN role text NOT NULL DEFAULT 'host',
      ADD COLUMN manager_id uuid REFERENCES event_managers(id) ON DELETE CASCADE;

    ALTER TABLE event_host_sessions
      ADD CONSTRAINT event_host_sessions_role_check
        CHECK (role IN ('host', 'manager')),
      ADD CONSTRAINT event_host_sessions_manager_role_check
        CHECK (
          (role = 'host' AND manager_id IS NULL)
          OR (role = 'manager' AND manager_id IS NOT NULL)
        );

    CREATE INDEX event_host_sessions_manager_id_idx
      ON event_host_sessions (manager_id);

    ALTER TABLE email_deliveries DROP CONSTRAINT email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'email_verification',
          'registration_otp', 'host_welcome', 'password_reset',
          'profile_reminder'
        )
      );

    ALTER TABLE host_audit_log DROP CONSTRAINT host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
        CHECK (action IN (
          'login_success', 'login_failure', 'login_locked',
          'registration_code_requested', 'registration_code_verified',
          'registration_code_failed', 'registration_completed',
          'email_verified',
          'password_changed', 'password_reset',
          'profile_updated',
          'event_created', 'event_deleted',
          'guest_added', 'guest_updated', 'guest_deleted',
          'guest_invitation_resent', 'guest_access_revoked',
          'manage_link_rotated', 'manage_link_resent',
          'manager_added', 'manager_removed', 'manager_invite_resent',
          'manager_link_used'
        ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM email_deliveries WHERE message_type = 'manager_invite';

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
        CHECK (action IN (
          'login_success', 'login_failure', 'login_locked',
          'registration_code_requested', 'registration_code_verified',
          'registration_code_failed', 'registration_completed',
          'email_verified',
          'password_changed', 'password_reset',
          'profile_updated',
          'event_created', 'event_deleted',
          'guest_added', 'guest_updated', 'guest_deleted',
          'guest_invitation_resent', 'guest_access_revoked',
          'manage_link_rotated', 'manage_link_resent'
        ));

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'invitation', 'reminder', 'decline_notification',
          'event_cancelled', 'email_verification', 'registration_otp',
          'host_welcome', 'password_reset', 'profile_reminder'
        )
      );

    DROP INDEX IF EXISTS event_host_sessions_manager_id_idx;
    ALTER TABLE event_host_sessions
      DROP CONSTRAINT IF EXISTS event_host_sessions_manager_role_check,
      DROP CONSTRAINT IF EXISTS event_host_sessions_role_check,
      DROP COLUMN IF EXISTS manager_id,
      DROP COLUMN IF EXISTS role;

    DROP TABLE IF EXISTS event_managers;
  `);
};
