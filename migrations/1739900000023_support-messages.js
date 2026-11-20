/**
 * Mensagens de apoio do formulário público (Bloco 7).
 *
 * - `status` só aceita `open` ou `resolved`, com `resolved_at` e
 *   `resolved_by` preenchidos no momentos em que o super admin marca a
 *   mensagem como resolvida;
 * - o índice `(status, created_at DESC)` serve a listagem administrativa
 *   sem carregar mensagens resolvidas antigas;
 * - as acções de auditoria novas são acrescentadas ao CHECK de
 *   `host_audit_log`; `down` repõe exactamente a lista anterior.
 *
 * A migração é idempotente (`IF NOT EXISTS`) e reversível.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      email       text NOT NULL,
      message     text NOT NULL,
      status      text NOT NULL DEFAULT 'open'
        CONSTRAINT support_messages_status_check CHECK (status IN ('open', 'resolved')),
      resolved_at timestamptz,
      resolved_by uuid,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS support_messages_status_created_idx
      ON support_messages (status, created_at DESC);

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (
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
        'manager_link_used', 'manager_access_suspicious',
        'support_message_resolved', 'newsletter_subscription_removed'
      ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_audit_log
     WHERE action IN ('support_message_resolved', 'newsletter_subscription_removed');

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (
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
        'manager_link_used', 'manager_access_suspicious'
      ));

    DROP INDEX IF EXISTS support_messages_status_created_idx;
    DROP TABLE IF EXISTS support_messages;
  `);
};
