/**
 * Liga gestores de evento a equipas e prepara o acesso por link + código.
 *
 * - `event_managers` passa a ter sempre `team_id`: criar um gestor passa
 *   a significar criar a equipa dele na mesma transacção;
 * - um contacto é obrigatório: `email` ou `phone` (normalizado E.164);
 * - o código de acesso nunca é guardado em texto: só o HMAc com pepper e
 *   id do gestor;
 * - a validade do link passa a ser controlada pelo anfitrião, com o
 *   limite absoluto de 1 dia após o fim do evento;
 * - membros de equipa também podem ter apenas telefone.
 *
 * A migração é reversível: `down` remove as colunas novas e repõe as
 * restrições anteriores. Gestores e membros sem email recebem um email
 * local apenas para satisfazer a coluna antiga `NOT NULL`.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE event_managers
      ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS phone text,
      ADD COLUMN IF NOT EXISTS display_name text,
      ADD COLUMN IF NOT EXISTS access_code_hash text,
      ADD COLUMN IF NOT EXISTS access_failed_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS access_locked_until timestamptz,
      ADD COLUMN IF NOT EXISTS link_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS link_revoked_at timestamptz;

    ALTER TABLE event_managers ALTER COLUMN email DROP NOT NULL;

    ALTER TABLE event_managers
      DROP CONSTRAINT IF EXISTS event_managers_contact_check;
    ALTER TABLE event_managers
      ADD CONSTRAINT event_managers_contact_check
        CHECK (email IS NOT NULL OR phone IS NOT NULL);

    CREATE INDEX IF NOT EXISTS event_managers_team_id_idx
      ON event_managers (team_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS event_managers_phone_idx
      ON event_managers (phone) WHERE phone IS NOT NULL;

    DO $$
    DECLARE
      manager RECORD;
      target_team_id uuid;
      team_name text;
      base_name text;
      suffix integer;
      local_name text;
      maximum_expiry timestamptz;
    BEGIN
      FOR manager IN
        SELECT em.*, e.ends_at, e.starts_at, e.timezone
          FROM event_managers em
          JOIN events e ON e.id = em.event_id
         ORDER BY em.created_at, em.id
      LOOP
        target_team_id := NULL;

        -- Reaproveita a equipa onde o gestor já é membro, desde que essa
        -- equipa ainda não tenha outro gestor activo.
        SELECT tm.team_id INTO target_team_id
          FROM team_members tm
          JOIN teams t
            ON t.id = tm.team_id
           AND t.event_id = manager.event_id
           AND t.deleted_at IS NULL
         WHERE tm.removed_at IS NULL
           AND tm.role = 'gestor'
           AND tm.email IS NOT NULL
           AND lower(tm.email::text) = lower(manager.email::text)
           AND NOT EXISTS (
             SELECT 1
               FROM event_managers occupied
              WHERE occupied.team_id = tm.team_id
                AND occupied.revoked_at IS NULL
                AND occupied.id <> manager.id
           )
         ORDER BY tm.created_at, tm.id
         LIMIT 1;

        IF target_team_id IS NULL THEN
          local_name := COALESCE(
            NULLIF(btrim(manager.display_name), ''),
            NULLIF(split_part(manager.email::text, '@', 1), ''),
            'Gestor'
          );
          base_name := left('Equipa de ' || local_name, 70);
          team_name := base_name;
          suffix := 2;

          WHILE EXISTS (
            SELECT 1
              FROM teams
             WHERE event_id = manager.event_id
               AND lower(btrim(name)) = lower(team_name)
               AND deleted_at IS NULL
          ) LOOP
            team_name := left(base_name, 65) || ' (' || suffix || ')';
            suffix := suffix + 1;
          END LOOP;

          INSERT INTO teams (event_id, name, category, description, created_by_host_id)
          SELECT manager.event_id,
                 team_name,
                 'outra',
                 'Equipa criada automaticamente para um gestor existente.',
                 e.host_id
            FROM events e
           WHERE e.id = manager.event_id
          RETURNING id INTO target_team_id;
        END IF;

        maximum_expiry := CASE
          WHEN manager.ends_at IS NOT NULL THEN manager.ends_at + interval '1 day'
          ELSE (
            date_trunc('day', manager.starts_at AT TIME ZONE manager.timezone)
            + interval '1 day'
          ) AT TIME ZONE manager.timezone + interval '1 day'
        END;

        UPDATE event_managers
           SET team_id = target_team_id,
               link_expires_at = CASE
                 WHEN maximum_expiry IS NOT NULL AND maximum_expiry > now()
                   THEN LEAST(now() + interval '7 days', maximum_expiry)
                 ELSE now() + interval '1 day'
               END
         WHERE id = manager.id;
      END LOOP;
    END $$;

    ALTER TABLE event_managers ALTER COLUMN team_id SET NOT NULL;

    CREATE UNIQUE INDEX event_managers_one_active_per_team
      ON event_managers (team_id) WHERE revoked_at IS NULL;

    ALTER TABLE team_members
      ADD COLUMN IF NOT EXISTS phone text;

    ALTER TABLE team_members ALTER COLUMN email DROP NOT NULL;

    ALTER TABLE team_members
      DROP CONSTRAINT IF EXISTS team_members_contact_check;
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_contact_check
        CHECK (email IS NOT NULL OR phone IS NOT NULL);

    DROP INDEX IF EXISTS team_members_team_email_unique;
    CREATE UNIQUE INDEX team_members_team_email_unique
      ON team_members (team_id, email)
      WHERE removed_at IS NULL AND email IS NOT NULL;
    CREATE UNIQUE INDEX team_members_team_phone_unique
      ON team_members (team_id, phone)
      WHERE removed_at IS NULL AND phone IS NOT NULL;
    CREATE INDEX IF NOT EXISTS team_members_phone_idx
      ON team_members (phone) WHERE phone IS NOT NULL;

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
        'manager_link_used', 'manager_access_suspicious'
      ));

    ALTER TABLE host_notifications DROP CONSTRAINT IF EXISTS host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (kind IN (
        'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
        'event_created', 'event_upcoming', 'rsvp_deadline',
        'task_assigned', 'task_completed', 'task_reassigned',
        'team_added', 'role_changed', 'access_suspicious'
      ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM host_notifications WHERE kind = 'access_suspicious';
    DELETE FROM host_audit_log WHERE action = 'manager_access_suspicious';

    ALTER TABLE host_notifications DROP CONSTRAINT IF EXISTS host_notifications_kind_check;
    ALTER TABLE host_notifications
      ADD CONSTRAINT host_notifications_kind_check CHECK (kind IN (
        'rsvp_accepted', 'rsvp_declined', 'guest_added', 'reminder_sent',
        'event_created', 'event_upcoming', 'rsvp_deadline',
        'task_assigned', 'task_completed', 'task_reassigned',
        'team_added', 'role_changed'
      ));

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
        'manager_link_used'
      ));

    DROP INDEX IF EXISTS event_managers_phone_idx;
    DROP INDEX IF EXISTS event_managers_team_id_idx;
    DROP INDEX IF EXISTS event_managers_one_active_per_team;

    ALTER TABLE event_managers
      DROP CONSTRAINT IF EXISTS event_managers_contact_check,
      DROP COLUMN IF EXISTS link_revoked_at,
      DROP COLUMN IF EXISTS link_expires_at,
      DROP COLUMN IF EXISTS access_locked_until,
      DROP COLUMN IF EXISTS access_failed_count,
      DROP COLUMN IF EXISTS access_code_hash,
      DROP COLUMN IF EXISTS display_name,
      DROP COLUMN IF EXISTS phone,
      DROP COLUMN IF EXISTS team_id;

    UPDATE event_managers
       SET email = 'sem-email-' || id || '@local.invalid'
     WHERE email IS NULL;
    ALTER TABLE event_managers ALTER COLUMN email SET NOT NULL;

    DROP INDEX IF EXISTS team_members_phone_idx;
    DROP INDEX IF EXISTS team_members_team_phone_unique;
    DROP INDEX IF EXISTS team_members_team_email_unique;
    CREATE UNIQUE INDEX team_members_team_email_unique
      ON team_members (team_id, email)
      WHERE removed_at IS NULL;

    ALTER TABLE team_members
      DROP CONSTRAINT IF EXISTS team_members_contact_check,
      DROP COLUMN IF EXISTS phone;

    UPDATE team_members
       SET email = 'sem-email-' || id || '@local.invalid'
     WHERE email IS NULL;
    ALTER TABLE team_members ALTER COLUMN email SET NOT NULL;
  `);
};
