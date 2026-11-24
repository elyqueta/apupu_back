/**
 * Bloco 12 — amizades entre contas.
 *
 * - `friendships`: pedido de `requester_id` para `addressee_id`, com estado
 *   `pending | accepted | rejected | blocked`. O par é único
 *   independentemente da ordem (índice sobre `least/greatest`).
 * - Novos tipos de notificação in-app: `friend_request`, `friend_accepted`.
 *
 * Reversível: `down` apaga as notificações novas, repõe o `CHECK` e remove
 * a tabela.
 */
const KINDS_BASE = `
  'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
  'event_created', 'event_upcoming', 'rsvp_deadline',
  'task_assigned', 'task_completed', 'task_reassigned',
  'team_added', 'role_changed', 'access_suspicious'
`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS friendships (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id  uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      addressee_id  uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      status        text NOT NULL DEFAULT 'pending',
      created_at    timestamptz NOT NULL DEFAULT now(),
      responded_at  timestamptz,
      CONSTRAINT friendships_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
      CONSTRAINT friendships_distinct_check CHECK (requester_id <> addressee_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uidx
      ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
    CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);
    CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status, created_at DESC);

    ALTER TABLE host_notifications DROP CONSTRAINT IF EXISTS host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (kind IN (${KINDS_BASE}, 'friend_request', 'friend_accepted'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_notifications WHERE kind IN ('friend_request', 'friend_accepted');
    ALTER TABLE host_notifications DROP CONSTRAINT IF EXISTS host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (kind IN (${KINDS_BASE}));
    DROP TABLE IF EXISTS friendships;
  `);
};
