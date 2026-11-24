/**
 * Registo honesto do reencaminhamento de um convite individual no WhatsApp.
 *
 * A aplicação abre o WhatsApp com a mensagem pré-preenchida, mas não consegue
 * saber se a pessoa chegou a enviá-la. Por isso guardamos apenas que o
 * anfitrião iniciou a partilha daquele link (`whatsapp_shared_at`) e quantas
 * vezes o fez (`whatsapp_share_count`). Nunca é interpretado como entrega ou
 * leitura pelo convidado.
 *
 * A acção de auditoria nova é acrescentada ao CHECK de `host_audit_log`;
 * `down` repõe exactamente a lista da migração 0023. Reversível e idempotente.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invitations
      ADD COLUMN IF NOT EXISTS whatsapp_shared_at timestamptz,
      ADD COLUMN IF NOT EXISTS whatsapp_share_count integer NOT NULL DEFAULT 0;

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (
        'login_success', 'login_failure', 'login_locked',
        'registration_code_requested', 'registration_code_verified',
        'registration_code_failed', 'registration_completed',
        'email_verified',
        'password_changed', 'password_reset',
        'profile_updated',
        'event_created', 'event_deleted',
        'guest_added', 'guest_updated', 'guest_deleted',
        'guest_invitation_resent', 'guest_access_revoked',
        'guest_whatsapp_shared',
        'manage_link_rotated', 'manage_link_resent',
        'manager_added', 'manager_removed', 'manager_invite_resent',
        'manager_link_used', 'manager_access_suspicious',
        'support_message_resolved', 'newsletter_subscription_removed'
      ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_audit_log WHERE action = 'guest_whatsapp_shared';

    ALTER TABLE host_audit_log DROP CONSTRAINT IF EXISTS host_audit_log_action_check;
    ALTER TABLE host_audit_log
      ADD CONSTRAINT host_audit_log_action_check CHECK (action IN (
        'login_success', 'login_failure', 'login_locked',
        'registration_code_requested', 'registration_code_verified',
        'registration_code_failed', 'registration_completed',
        'email_verified',
        'password_changed', 'password_reset',
        'profile_updated',
        'event_created', 'event_deleted',
        'guest_added', 'guest_updated', 'guest_deleted',
        'guest_invitation_resent', 'guest_access_revoked',
        'manage_link_rotated', 'manage_link_resent',
        'manager_added', 'manager_removed', 'manager_invite_resent',
        'manager_link_used', 'manager_access_suspicious',
        'support_message_resolved', 'newsletter_subscription_removed'
      ));

    ALTER TABLE invitations
      DROP COLUMN IF EXISTS whatsapp_share_count,
      DROP COLUMN IF EXISTS whatsapp_shared_at;
  `);
};
