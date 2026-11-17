/**
 * Tarefas atribuídas a gestores e imagem de capa do evento.
 *
 * Tarefas:
 * - `manager_id` associa uma tarefa a um gestor de evento. O `host_id`
 *   continua a ser o proprietário da tarefa (a conta do anfitrião);
 * - tarefas de gestor exigem `event_id` (constraint), porque o gestor
 *   só existe no contexto de um evento;
 * - `completed_at` registra quando a tarefa passou a cumprida, sem
 *   perder o histórico ao desmarcar.
 *
 * Capa:
 * - `cover_url` é a imagem apresentada no evento e no convite;
 * - `cover_hash` permite que um novo upload do mesmo ficheiro seja
 *   idempotente (não volta a subir para o Cloudinary);
 * - `cover_public_id` permite remover o asset antigo quando a capa é
 *   substituída ou removida.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_tasks
      ADD COLUMN manager_id uuid REFERENCES event_managers(id) ON DELETE SET NULL,
      ADD COLUMN completed_at timestamptz;

    UPDATE host_tasks
       SET completed_at = updated_at
     WHERE done = true
       AND completed_at IS NULL;

    ALTER TABLE host_tasks
      ADD CONSTRAINT host_tasks_manager_event_check
      CHECK (manager_id IS NULL OR event_id IS NOT NULL);

    CREATE INDEX host_tasks_host_created_idx
      ON host_tasks (host_id, created_at DESC, id DESC);

    CREATE INDEX host_tasks_manager_idx
      ON host_tasks (manager_id)
      WHERE manager_id IS NOT NULL;

    ALTER TABLE events
      ADD COLUMN cover_url text,
      ADD COLUMN cover_hash text,
      ADD COLUMN cover_public_id text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE events
      DROP COLUMN IF EXISTS cover_public_id,
      DROP COLUMN IF EXISTS cover_hash,
      DROP COLUMN IF EXISTS cover_url;

    DROP INDEX IF EXISTS host_tasks_manager_idx;
    DROP INDEX IF EXISTS host_tasks_host_created_idx;

    ALTER TABLE host_tasks
      DROP CONSTRAINT IF EXISTS host_tasks_manager_event_check,
      DROP COLUMN IF EXISTS completed_at,
      DROP COLUMN IF EXISTS manager_id;
  `);
};
