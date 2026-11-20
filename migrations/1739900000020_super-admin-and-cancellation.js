/**
 * Super admin, cancelamento de eventos e separação dos OTP.
 *
 * - `hosts.is_super_admin` representa o papel `super_admin` pedido no
 *   Bloco 6 (promoção apenas por SQL);
 * - `events` passa a guardar quem cancelou, quando e o motivo, sem
 *   apagar qualquer dado;
 * - `admin_audit_log` regista todas as acções admin;
 * - `registration_verifications.purpose` impede que um OTP de registo
 *   seja usado para cancelar um evento (e vice-versa).
 *
 * `down` remove apenas colunas/objectos criados aqui. As linhas de
 * auditoria são deixadas intactas: são append-only e sobrevivem a um
 * rollback da migração por decisão de segurança.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE hosts
      ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

    ALTER TABLE events
      ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
      ADD COLUMN IF NOT EXISTS cancelled_reason text,
      ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES hosts(id);

    ALTER TABLE registration_verifications
      ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'registration';

    UPDATE registration_verifications
       SET purpose = 'registration'
     WHERE purpose IS NULL;

    CREATE INDEX IF NOT EXISTS registration_verifications_purpose_idx
      ON registration_verifications (purpose, email, created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id uuid NOT NULL REFERENCES hosts(id),
      action text NOT NULL,
      target_type text,
      target_id uuid,
      reason text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
      ON admin_audit_log (created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_audit_log_admin_idx
      ON admin_audit_log (admin_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
      ON admin_audit_log (target_type, target_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS admin_audit_log;

    ALTER TABLE events
      DROP COLUMN IF EXISTS cancelled_by,
      DROP COLUMN IF EXISTS cancelled_reason,
      DROP COLUMN IF EXISTS cancelled_at;

    ALTER TABLE hosts
      DROP COLUMN IF EXISTS is_super_admin;

    DROP INDEX IF EXISTS registration_verifications_purpose_idx;
    ALTER TABLE registration_verifications
      DROP COLUMN IF EXISTS purpose;
  `);
};
