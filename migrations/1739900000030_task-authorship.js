/**
 * Autoria persistente das tarefas (pedido do autor, 24/11/2026).
 *
 * - `host_tasks.created_by_name`: cópia do nome de quem criou a tarefa,
 *   preenchida por trigger em qualquer caminho de criação e com backfill
 *   das tarefas existentes. O nome continua visível mesmo que a conta
 *   mude de nome ou seja removida.
 * - `created_by_host_id` deixa de apagar a tarefa em cascata (passa a
 *   `SET NULL`): a autoria fica pelo nome guardado.
 *
 * Reversível: `down` remove o trigger e a coluna e repõe o `CASCADE`.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_tasks ADD COLUMN IF NOT EXISTS created_by_name text;

    UPDATE host_tasks t
       SET created_by_name = COALESCE(NULLIF(btrim(p.display_name), ''), split_part(h.email::text, '@', 1))
      FROM hosts h
      LEFT JOIN host_profiles p ON p.host_id = h.id
     WHERE h.id = COALESCE(t.created_by_host_id, t.host_id)
       AND t.created_by_name IS NULL;

    CREATE OR REPLACE FUNCTION host_tasks_snapshot_author()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.created_by_name IS NULL AND COALESCE(NEW.created_by_host_id, NEW.host_id) IS NOT NULL THEN
        SELECT COALESCE(NULLIF(btrim(p.display_name), ''), split_part(h.email::text, '@', 1))
          INTO NEW.created_by_name
          FROM hosts h
          LEFT JOIN host_profiles p ON p.host_id = h.id
         WHERE h.id = COALESCE(NEW.created_by_host_id, NEW.host_id);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS host_tasks_snapshot_author ON host_tasks;
    CREATE TRIGGER host_tasks_snapshot_author
      BEFORE INSERT ON host_tasks
      FOR EACH ROW EXECUTE FUNCTION host_tasks_snapshot_author();

    ALTER TABLE host_tasks DROP CONSTRAINT IF EXISTS host_tasks_created_by_host_id_fkey;
    ALTER TABLE host_tasks
      ADD CONSTRAINT host_tasks_created_by_host_id_fkey
      FOREIGN KEY (created_by_host_id) REFERENCES hosts(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_tasks DROP CONSTRAINT IF EXISTS host_tasks_created_by_host_id_fkey;
    ALTER TABLE host_tasks
      ADD CONSTRAINT host_tasks_created_by_host_id_fkey
      FOREIGN KEY (created_by_host_id) REFERENCES hosts(id) ON DELETE CASCADE;

    DROP TRIGGER IF EXISTS host_tasks_snapshot_author ON host_tasks;
    DROP FUNCTION IF EXISTS host_tasks_snapshot_author();
    ALTER TABLE host_tasks DROP COLUMN IF EXISTS created_by_name;
  `);
};
