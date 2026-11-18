/**
 * Aviso de convite removido.
 *
 * Quando o email de um convidado é corrigido ou o convite é apagado, o
 * destinatário anterior recebe uma mensagem a informar que o link
 * deixou de ser válido. A mensagem não depende do convite continuar a
 * existir (é enfileirada com `invitation_id = NULL`).
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_deliveries DROP CONSTRAINT email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'invitation_removed',
          'email_verification', 'registration_otp', 'host_welcome',
          'password_reset', 'profile_reminder'
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM email_deliveries WHERE message_type = 'invitation_removed';

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'email_verification',
          'registration_otp', 'host_welcome', 'password_reset',
          'profile_reminder'
        )
      );
  `);
};
