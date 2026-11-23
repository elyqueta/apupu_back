/**
 * Bloco 10 — visibilidade de eventos e perfis, link público, idade e
 * remoção lógica de eventos.
 *
 * - `events.visibility` (`private` por defeito: eventos existentes não
 *   mudam de comportamento), `public_slug` aleatório gerado ao tornar
 *   público, `show_attendee_count`, limites de idade opcionais e
 *   `deleted_at` (soft delete).
 * - `hosts.profile_visibility` (`private` por defeito).
 * - `invitations`: origem (`personal | public_link`), idade indicada,
 *   marcação de idade alterada e telefone normalizado. Confirmações pelo
 *   link público podem ter só telefone, por isso `guest_email` deixa de
 *   ser obrigatório — mas continua obrigatório em convites pessoais.
 * - `host_birth_date_changes`: histórico das alterações da data de
 *   nascimento, usado para marcar confirmações suspeitas.
 *
 * `down` repõe o esquema anterior. Como antes desta migração a remoção
 * de eventos era física e não havia confirmações sem email, `down` apaga
 * os eventos removidos logicamente e as confirmações sem email.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE events
      ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
      ADD COLUMN IF NOT EXISTS public_slug text,
      ADD COLUMN IF NOT EXISTS show_attendee_count boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS min_age smallint,
      ADD COLUMN IF NOT EXISTS max_age smallint,
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_visibility_check;
    ALTER TABLE events
      ADD CONSTRAINT events_visibility_check CHECK (visibility IN ('public', 'private'));

    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_age_check;
    ALTER TABLE events
      ADD CONSTRAINT events_age_check CHECK (
        (min_age IS NULL OR min_age BETWEEN 0 AND 120)
        AND (max_age IS NULL OR max_age BETWEEN 0 AND 120)
        AND (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
      );

    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_public_slug_check;
    ALTER TABLE events
      ADD CONSTRAINT events_public_slug_check CHECK (
        public_slug IS NULL OR public_slug ~ '^[A-Za-z0-9_-]{10,64}$'
      );

    CREATE UNIQUE INDEX IF NOT EXISTS events_public_slug_uidx
      ON events (public_slug)
      WHERE public_slug IS NOT NULL;

    CREATE INDEX IF NOT EXISTS events_not_deleted_idx
      ON events (host_id)
      WHERE deleted_at IS NULL;

    ALTER TABLE hosts
      ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'private';
    ALTER TABLE hosts DROP CONSTRAINT IF EXISTS hosts_profile_visibility_check;
    ALTER TABLE hosts
      ADD CONSTRAINT hosts_profile_visibility_check
      CHECK (profile_visibility IN ('public', 'private'));

    ALTER TABLE invitations
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'personal',
      ADD COLUMN IF NOT EXISTS guest_age smallint,
      ADD COLUMN IF NOT EXISTS age_flag boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS age_flag_reason text,
      ADD COLUMN IF NOT EXISTS guest_phone_normalized text;

    ALTER TABLE invitations ALTER COLUMN guest_email DROP NOT NULL;

    ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_source_check;
    ALTER TABLE invitations
      ADD CONSTRAINT invitations_source_check CHECK (source IN ('personal', 'public_link'));

    ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_contact_check;
    ALTER TABLE invitations
      ADD CONSTRAINT invitations_contact_check CHECK (
        guest_email IS NOT NULL
        OR (source = 'public_link' AND guest_phone_normalized IS NOT NULL)
      );

    ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_guest_age_check;
    ALTER TABLE invitations
      ADD CONSTRAINT invitations_guest_age_check CHECK (
        guest_age IS NULL OR guest_age BETWEEN 0 AND 120
      );

    ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_age_flag_reason_check;
    ALTER TABLE invitations
      ADD CONSTRAINT invitations_age_flag_reason_check CHECK (
        age_flag_reason IS NULL OR age_flag_reason IN ('birth_date_changed')
      );

    CREATE UNIQUE INDEX IF NOT EXISTS invitations_public_email_uidx
      ON invitations (event_id, lower(guest_email))
      WHERE source = 'public_link' AND guest_email IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS invitations_public_phone_uidx
      ON invitations (event_id, guest_phone_normalized)
      WHERE source = 'public_link' AND guest_phone_normalized IS NOT NULL;

    CREATE TABLE IF NOT EXISTS host_birth_date_changes (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id     uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      old_value   date,
      new_value   date,
      changed_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS host_birth_date_changes_host_idx
      ON host_birth_date_changes (host_id, changed_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS host_birth_date_changes;

    DROP INDEX IF EXISTS invitations_public_phone_uidx;
    DROP INDEX IF EXISTS invitations_public_email_uidx;

    DELETE FROM invitations WHERE guest_email IS NULL;

    ALTER TABLE invitations
      DROP CONSTRAINT IF EXISTS invitations_age_flag_reason_check,
      DROP CONSTRAINT IF EXISTS invitations_guest_age_check,
      DROP CONSTRAINT IF EXISTS invitations_contact_check,
      DROP CONSTRAINT IF EXISTS invitations_source_check;

    ALTER TABLE invitations ALTER COLUMN guest_email SET NOT NULL;

    ALTER TABLE invitations
      DROP COLUMN IF EXISTS guest_phone_normalized,
      DROP COLUMN IF EXISTS age_flag_reason,
      DROP COLUMN IF EXISTS age_flag,
      DROP COLUMN IF EXISTS guest_age,
      DROP COLUMN IF EXISTS source;

    ALTER TABLE hosts DROP CONSTRAINT IF EXISTS hosts_profile_visibility_check;
    ALTER TABLE hosts DROP COLUMN IF EXISTS profile_visibility;

    DELETE FROM events WHERE deleted_at IS NOT NULL;

    DROP INDEX IF EXISTS events_not_deleted_idx;
    DROP INDEX IF EXISTS events_public_slug_uidx;

    ALTER TABLE events
      DROP CONSTRAINT IF EXISTS events_public_slug_check,
      DROP CONSTRAINT IF EXISTS events_age_check,
      DROP CONSTRAINT IF EXISTS events_visibility_check;

    ALTER TABLE events
      DROP COLUMN IF EXISTS deleted_at,
      DROP COLUMN IF EXISTS max_age,
      DROP COLUMN IF EXISTS min_age,
      DROP COLUMN IF EXISTS show_attendee_count,
      DROP COLUMN IF EXISTS public_slug,
      DROP COLUMN IF EXISTS visibility;
  `);
};
