/**
 * Fase 3 — correções de convites, bloqueios e catálogo.
 *
 * - acrescenta `created_by_host_id` a `team_invites` para identificar
 *   o anfitrião que criou o convite (o remetente original);
 * - cria `team_invite_blocks`, que bloqueia um par (anfitrião, email)
 *   depois de o destinatário escolher "Não conheço este convite";
 * - alinha os tipos da outbox e os `kind` das notificações com o
 *   catálogo final: entram `team_added` e `team_role_changed`, saem
 *   `member_removed` (quem é removido não recebe mensagem) e
 *   `team_invite` das notificações in-app (o convite é só email).
 *
 * O `down` repõe exactamente o estado da migração 13, apagando apenas
 * as linhas que deixariam de ser válidas nas constraints antigas.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE team_invites
      ADD COLUMN created_by_host_id uuid REFERENCES hosts(id) ON DELETE SET NULL;

    UPDATE team_invites ti
       SET created_by_host_id = m.invited_by_host_id
      FROM team_members m
     WHERE m.id = ti.member_id
       AND ti.created_by_host_id IS NULL;

    CREATE INDEX team_invites_created_by_created_idx
      ON team_invites (created_by_host_id, created_at DESC);

    CREATE TABLE team_invite_blocks (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id    uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      email      citext NOT NULL,
      reason     text NOT NULL DEFAULT 'unknown_invite',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT team_invite_blocks_host_email_unique UNIQUE (host_id, email)
    );

    CREATE INDEX team_invite_blocks_email_idx
      ON team_invite_blocks (email);

    DELETE FROM host_notifications
     WHERE kind IN ('team_invite', 'member_removed');

    ALTER TABLE host_notifications DROP CONSTRAINT host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (
        kind IN (
          'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
          'event_created', 'event_upcoming', 'rsvp_deadline',
          'task_assigned', 'task_completed', 'task_reassigned',
          'team_added', 'role_changed'
        )
      );

    DELETE FROM email_deliveries
     WHERE message_type = 'member_removed';

    ALTER TABLE email_deliveries DROP CONSTRAINT email_deliveries_type_check;
    ALTER TABLE email_deliveries
      ADD CONSTRAINT email_deliveries_type_check CHECK (
        message_type IN (
          'manage_link', 'manager_invite', 'invitation', 'reminder',
          'decline_notification', 'event_cancelled', 'invitation_removed',
          'email_verification', 'registration_otp', 'host_welcome',
          'password_reset', 'profile_reminder',
          'team_invite', 'team_added', 'team_role_changed',
          'task_assigned', 'task_completed', 'task_reassigned'
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_notifications
     WHERE kind IN ('team_added');

    ALTER TABLE host_notifications DROP CONSTRAINT IF EXISTS host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (
        kind IN (
          'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
          'event_created', 'event_upcoming', 'rsvp_deadline',
          'task_assigned', 'task_completed',
          'task_reassigned', 'team_invite', 'member_removed', 'role_changed'
        )
      );

    DELETE FROM email_deliveries
     WHERE message_type IN ('team_added', 'team_role_changed');

    ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_type_check;
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

    DROP INDEX IF EXISTS team_invite_blocks_email_idx;
    DROP TABLE IF EXISTS team_invite_blocks;
    DROP INDEX IF EXISTS team_invites_created_by_created_idx;
    ALTER TABLE team_invites DROP COLUMN IF EXISTS created_by_host_id;
  `);
};
