/**
 * Dá validade ao link individual de cada convite.
 *
 * O valor por defeito é o fim do evento + 1 dia. Quando o evento não tem
 * `ends_at`, usa-se o fim do dia de `starts_at` no fuso do evento (a
 * mesma regra de `linkValidityService.maximumFor`) e depois + 1 dia.
 *
 * A coluna passa a `NOT NULL`: um convite sem validade não pode ficar
 * pendente para sempre. A migração é reversível — `down` remove a coluna.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invitations
      ADD COLUMN IF NOT EXISTS link_expires_at timestamptz;

    UPDATE invitations i
       SET link_expires_at = CASE
             WHEN e.ends_at IS NOT NULL THEN e.ends_at + interval '1 day'
             ELSE (
               (
                 date_trunc('day', e.starts_at AT TIME ZONE e.timezone) + interval '1 day'
               ) AT TIME ZONE e.timezone
             ) + interval '1 day'
           END
      FROM events e
     WHERE e.id = i.event_id
       AND i.link_expires_at IS NULL;

    ALTER TABLE invitations
      ALTER COLUMN link_expires_at SET NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE invitations
      DROP COLUMN IF EXISTS link_expires_at;
  `);
};
