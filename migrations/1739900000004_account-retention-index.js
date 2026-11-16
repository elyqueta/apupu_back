/**
 * Índice de apoio ao job de retenção de contas.
 *
 * O corte é `COALESCE(last_login_at, created_at) < cutoff`. Um índice
 * de expressão permite filtrar e ordenar sem sequential scan em
 * `hosts`, mesmo com muitas contas.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX hosts_retention_idx
      ON hosts (COALESCE(last_login_at, created_at));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS hosts_retention_idx;
  `);
};
