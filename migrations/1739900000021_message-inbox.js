/**
 * Caixa de entrada de mensagens (Bloco 5, Parte F).
 *
 * A resposta do anfitrião não fica sem destino: é guardada no convite,
 * devolvida no DTO público e notificada por email ao convidado. A
 * leitura pelo anfitrião também é registada para filtros `read` e
 * `answered`.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invitations
      ADD COLUMN IF NOT EXISTS message_answer text,
      ADD COLUMN IF NOT EXISTS message_answered_at timestamptz,
      ADD COLUMN IF NOT EXISTS message_read_at timestamptz;

    CREATE INDEX IF NOT EXISTS invitations_message_activity_idx
      ON invitations (message_read_at, message_answered_at, created_at DESC);

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'invitation_removed',
          'email_verification', 'registration_otp', 'host_welcome',
          'password_reset', 'profile_reminder',
          'team_invite', 'team_added', 'team_role_changed',
          'task_assigned', 'task_completed', 'task_reassigned',
          'member_removed', 'invitation_reply'
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS invitations_message_activity_idx;

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'invitation_removed',
          'email_verification', 'registration_otp', 'host_welcome',
          'password_reset', 'profile_reminder',
          'team_invite', 'team_added', 'team_role_changed',
          'task_assigned', 'task_completed', 'task_reassigned',
          'member_removed'
        )
      );

    ALTER TABLE invitations
      DROP COLUMN IF EXISTS message_read_at,
      DROP COLUMN IF EXISTS message_answered_at,
      DROP COLUMN IF EXISTS message_answer;
  `);
};
