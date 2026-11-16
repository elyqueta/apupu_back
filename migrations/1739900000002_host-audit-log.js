/**
 * Auditoria de eventos críticos e validade dos links de gestão.
 *
 * - `host_audit_log` é append-only e independente do ciclo de vida das
 *   contas/eventos: `host_id` e `event_id` são UUIDs sem chave
 *   estrangeira, para que o registo sobreviva à eliminação do recurso.
 * - Nunca guarda senhas, tokens, `birth_date` nem outras PII
 *   desnecessárias; `metadata` é reservado a contagens e nomes de
 *   campos.
 * - Os eventos existentes com link de gestão sem validade passam a ter
 *   um limite de 30 dias a contar da migração, alinhados com a decisão
 *   de produto. Links já revogados mantêm-se revogados.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE host_audit_log (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id     uuid,
      event_id    uuid,
      action      text NOT NULL,
      outcome     text NOT NULL DEFAULT 'success',
      ip          inet,
      request_id  text,
      metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
      at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT host_audit_log_outcome_check
        CHECK (outcome IN ('success', 'failure')),
      CONSTRAINT host_audit_log_action_check
        CHECK (action IN (
          'login_success', 'login_failure', 'login_locked',
          'email_verified',
          'password_changed', 'password_reset',
          'profile_updated',
          'event_created', 'event_deleted',
          'guest_added', 'guest_updated', 'guest_deleted',
          'guest_invitation_resent', 'guest_access_revoked',
          'manage_link_rotated', 'manage_link_resent'
        ))
    );

    CREATE INDEX host_audit_log_host_at_idx ON host_audit_log (host_id, at DESC);
    CREATE INDEX host_audit_log_event_at_idx ON host_audit_log (event_id, at DESC);
    CREATE INDEX host_audit_log_at_idx ON host_audit_log (at DESC);

    UPDATE events
       SET manage_token_expires_at = now() + interval '30 days',
           updated_at = now()
     WHERE manage_token_expires_at IS NULL
       AND manage_token_revoked_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS host_audit_log;
  `);
};
