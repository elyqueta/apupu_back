/**
 * Fase 3 — notificações e e-mails de equipas/tarefas.
 *
 * - acrescenta `payload` a `email_deliveries` para guardar as variáveis
 *   de renderização (nome da equipa, título da tarefa, autor, etc.) sem
 *   duplicar colunas por cada mensagem;
 * - alarga os tipos de mensagem da outbox com as cinco mensagens novas;
 * - cria `team_invites`, que guarda apenas o HMAC do token do convite
 *   (nunca o token em claro) e controla expiração, aceitação e reenvios;
 * - alarga os `kind` de `host_notifications` para as notificações
 *   transacionais correspondentes.
 *
 * O `down` é completo: apaga as linhas dos tipos novos antes de
 * restaurar as constraints antigas, para que a migração seja reversível
 * mesmo com dados já gerados.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_deliveries
      ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE email_deliveries DROP CONSTRAINT email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'invitation_removed',
          'email_verification', 'registration_otp', 'host_welcome',
          'password_reset', 'profile_reminder',
          'team_invite', 'task_assigned', 'task_completed',
          'task_reassigned', 'member_removed'
        )
      );

    CREATE TABLE team_invites (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id    uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email        citext NOT NULL,
      token_hash   text NOT NULL UNIQUE,
      expires_at   timestamptz NOT NULL,
      accepted_at  timestamptz,
      revoked_at   timestamptz,
      send_count   integer NOT NULL DEFAULT 1,
      last_sent_at timestamptz NOT NULL DEFAULT now(),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT team_invites_send_count_check CHECK (send_count >= 0)
    );

    CREATE UNIQUE INDEX team_invites_one_active_per_member
      ON team_invites (member_id)
      WHERE accepted_at IS NULL AND revoked_at IS NULL;

    CREATE INDEX team_invites_email_created_idx
      ON team_invites (email, created_at DESC);

    CREATE INDEX team_invites_expiry_idx
      ON team_invites (expires_at)
      WHERE accepted_at IS NULL AND revoked_at IS NULL;

    CREATE INDEX email_deliveries_recipient_type_created_idx
      ON email_deliveries (recipient_email, message_type, created_at DESC);

    ALTER TABLE host_notifications DROP CONSTRAINT host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (
        kind IN (
          'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
          'event_created', 'event_upcoming', 'rsvp_deadline',
          'task_assigned', 'task_completed',
          'task_reassigned', 'team_invite', 'member_removed', 'role_changed'
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_notifications
     WHERE kind IN ('task_reassigned', 'team_invite', 'member_removed', 'role_changed');

    ALTER TABLE host_notifications DROP CONSTRAINT IF EXISTS host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (
        kind IN (
          'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
          'event_created', 'event_upcoming', 'rsvp_deadline',
          'task_assigned', 'task_completed'
        )
      );

    DELETE FROM email_deliveries
     WHERE message_type IN (
       'team_invite', 'task_assigned', 'task_completed',
       'task_reassigned', 'member_removed'
     );

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'invitation_removed',
          'email_verification', 'registration_otp', 'host_welcome',
          'password_reset', 'profile_reminder'
        )
      );

    DROP INDEX IF EXISTS email_deliveries_recipient_type_created_idx;
    DROP TABLE IF EXISTS team_invites;
    ALTER TABLE email_deliveries DROP COLUMN IF EXISTS payload;
  `);
};
