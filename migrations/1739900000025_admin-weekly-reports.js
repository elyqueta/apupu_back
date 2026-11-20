/**
 * Relatórios globais semanais gerados para download no painel admin (Bloco 8).
 *
 * O PDF fica na base de dados porque o sistema de ficheiros de ambientes
 * containerizados é efémero. `week_start` é única: quando várias instâncias
 * correm o agendador, apenas uma insere a linha e gera o documento.
 *
 * `down` remove apenas esta tabela; nenhuma outra estrutura é alterada.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS admin_weekly_reports (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      week_start   date NOT NULL UNIQUE,
      status       text NOT NULL DEFAULT 'generating'
                   CHECK (status IN ('generating', 'ready')),
      filename     text NOT NULL,
      content      bytea,
      size_bytes   integer NOT NULL DEFAULT 0,
      host_count   integer NOT NULL DEFAULT 0,
      generated_at timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS admin_weekly_reports_ready_idx
      ON admin_weekly_reports (status, week_start DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS admin_weekly_reports_ready_idx;
    DROP TABLE IF EXISTS admin_weekly_reports;
  `);
};
