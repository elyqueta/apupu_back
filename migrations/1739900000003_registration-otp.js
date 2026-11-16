/**
 * Verificação de email por OTP antes da criação da conta.
 *
 * O registo passa a ter três passos:
 *
 * 1. `POST /auth/register/request-code` valida a disponibilidade do
 *    email e envia um código de 6 dígitos.
 * 2. `POST /auth/register/verify-code` troca o código por um token de
 *    verificação de curta duração.
 * 3. `POST /auth/register` exige esse token e cria a conta já com
 *    `email_verified_at` preenchido.
 *
 * A tabela guarda apenas o HMAC do código e do token de verificação.
 * O código em claro existe unicamente no email; o token em claro é
 * devolvido uma única vez ao cliente.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE registration_verifications (
      id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email                         citext NOT NULL,
      code_hash                     text NOT NULL,
      attempts                      integer NOT NULL DEFAULT 0,
      expires_at                    timestamptz NOT NULL,
      verified_at                   timestamptz,
      verification_token_hash       text UNIQUE,
      verification_token_expires_at timestamptz,
      consumed_at                   timestamptz,
      created_at                    timestamptz NOT NULL DEFAULT now(),
      updated_at                    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT registration_verifications_attempts_check CHECK (attempts >= 0)
    );

    CREATE INDEX registration_verifications_email_idx
      ON registration_verifications (email, created_at DESC);
    CREATE INDEX registration_verifications_expiry_idx
      ON registration_verifications (expires_at);
    CREATE INDEX registration_verifications_token_idx
      ON registration_verifications (verification_token_hash)
      WHERE verification_token_hash IS NOT NULL;

    ALTER TABLE email_deliveries DROP CONSTRAINT email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'invitation', 'reminder', 'decline_notification',
          'event_cancelled', 'email_verification', 'registration_otp',
          'host_welcome', 'password_reset', 'profile_reminder'
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
          'manage_link_rotated', 'manage_link_resent'
        ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_audit_log
     WHERE action IN (
       'registration_code_requested', 'registration_code_verified',
       'registration_code_failed', 'registration_completed'
     );

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check
        CHECK (action IN (
          'login_success', 'login_failure', 'login_locked',
          'email_verified',
          'password_changed', 'password_reset',
          'profile_updated',
          'event_created', 'event_deleted',
          'guest_added', 'guest_updated', 'guest_deleted',
          'guest_invitation_resent', 'guest_access_revoked',
          'manage_link_rotated', 'manage_link_resent'
        ));

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    DELETE FROM email_deliveries WHERE message_type = 'registration_otp';
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'invitation', 'reminder', 'decline_notification',
          'event_cancelled', 'email_verification', 'host_welcome',
          'password_reset', 'profile_reminder'
        )
      );

    DROP TABLE IF EXISTS registration_verifications;
  `);
};
