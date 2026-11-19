/**
 * Índices de apoio às consultas de tarefas por equipa.
 *
 * As listas do workspace filtram sempre por equipa e estado (ou por
 * responsável e estado) e excluem tarefas arquivadas. Os índices
 * parciais mantêm o índice pequeno, porque as tarefas arquivadas são
 * uma minoria e nunca aparecem nas listas.
 *
 * `(event_id)` já existe desde a migração inicial (`host_tasks_event_id_idx`).
 *
 * `CREATE INDEX CONCURRENTLY` não pode correr dentro de uma transação.
 * Por isso a migração usa `pgm.noTransaction()` e emite cada índice
 * numa instrução separada. Vantagem: em produção o `host_tasks` não
 * fica bloqueado para escritas durante a criação dos índices. Como só
 * são criados índices, uma falha a meio não altera dados; o `down`
 * remove os índices com `DROP INDEX CONCURRENTLY`.
 */
exports.up = (pgm) => {
  pgm.noTransaction();

  pgm.sql(`
    CREATE INDEX CONCURRENTLY host_tasks_team_status_idx
      ON host_tasks (team_id, status)
      WHERE team_id IS NOT NULL
        AND archived_at IS NULL
  `);

  pgm.sql(`
    CREATE INDEX CONCURRENTLY host_tasks_assignee_status_idx
      ON host_tasks (assignee_member_id, status)
      WHERE assignee_member_id IS NOT NULL
        AND archived_at IS NULL
  `);

  pgm.sql(`
    CREATE INDEX CONCURRENTLY host_tasks_archived_at_idx
      ON host_tasks (archived_at)
      WHERE archived_at IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();

  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS host_tasks_archived_at_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS host_tasks_assignee_status_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS host_tasks_team_status_idx');
};
