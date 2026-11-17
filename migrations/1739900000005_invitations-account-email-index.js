/**
 * Índice de apoio a "Meus convites".
 *
 * A lista filtra `lower(guest_email) = lower(hosts.email)` e exclui
 * convites revogados. O índice funcional parcial evita um sequential
 * scan em `invitations`, sem alterar dados nem a associação (opção A).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX invitations_account_email_idx
      ON invitations (lower(guest_email))
      WHERE claim_revoked_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS invitations_account_email_idx;
  `);
};
