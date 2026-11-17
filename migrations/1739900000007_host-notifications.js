/**
 * Notificações in-app por conta de anfitrião.
 *
 * As actividades (`event_activity`) continuam a ser o histórico
 * append-only de cada evento. Esta tabela é uma camada separada, por
 * conta, para o sino da navbar e para a página de notificações:
 *
 * - `activity_id` liga a notificação à actividade que a originou; a
 *   remoção da actividade (feita apenas na gestão do evento) arrasta a
 *   notificação;
 * - `read_at` / `dismissed_at` permitem marcar como lida/vista e
 *   remover sem tocar no histórico;
 * - `dedupe_key` torna idempotente a geração de lembretes (evento a
 *   aproximar-se, prazo de RSVP);
 * - `title` / `body` são texto já legível para pesquisa no servidor.
 *
 * O `host_id` é sempre a conta que vê a notificação. Um gestor com
 * conta recebe a sua própria linha, mesmo que a actividade pertença ao
 * evento do anfitrião.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE host_notifications (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id      uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      event_id     uuid REFERENCES events(id) ON DELETE CASCADE,
      activity_id  uuid REFERENCES event_activity(id) ON DELETE CASCADE,
      kind         text NOT NULL,
      title        text NOT NULL,
      body         text,
      metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key   text,
      read_at      timestamptz,
      dismissed_at timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT host_notifications_kind_check CHECK (
        kind IN (
          'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
          'event_created', 'event_upcoming', 'rsvp_deadline',
          'task_assigned', 'task_completed'
        )
      )
    );

    CREATE INDEX host_notifications_host_created_idx
      ON host_notifications (host_id, created_at DESC, id DESC);

    CREATE INDEX host_notifications_host_unread_idx
      ON host_notifications (host_id)
      WHERE read_at IS NULL AND dismissed_at IS NULL;

    CREATE UNIQUE INDEX host_notifications_host_activity_uidx
      ON host_notifications (host_id, activity_id)
      WHERE activity_id IS NOT NULL;

    CREATE UNIQUE INDEX host_notifications_host_dedupe_uidx
      ON host_notifications (host_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS host_notifications;');
};
