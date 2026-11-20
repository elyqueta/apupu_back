/**
 * Suporte a login com Google na identidade existente.
 *
 * O projeto não tem uma tabela `users`: a identidade vive em `hosts` e
 * o perfil em `host_profiles`. Por isso "adicione ou atualize a tabela
 * de utilizadores" significa:
 *
 * - `id`            -> hosts.id (uuid, já existente)
 * - `google_id`     -> nova coluna em hosts (única, nullable)
 * - `email`         -> hosts.email (citext, única, já existente)
 * - `name`          -> host_profiles.display_name (já existente)
 * - `avatar_url`    -> host_profiles.avatar_url (já existente)
 * - `created_at` /
 *   `updated_at`    -> já existem nas duas tabelas
 *
 * `password_hash` passa a nullable porque uma conta só com Google não
 * tem senha local. `verifyPassword` já trata `null` como falha de senha.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE hosts
      ADD COLUMN IF NOT EXISTS google_id text,
      ALTER COLUMN password_hash DROP NOT NULL;

    -- UNIQUE aceita múltiplos NULL; o índice parcial deixa isso explícito
    -- e evita armazenar entradas para contas locais.
    CREATE UNIQUE INDEX IF NOT EXISTS hosts_google_id_unique
      ON hosts (google_id)
      WHERE google_id IS NOT NULL;

    -- Garante que toda a conta tem perfil e um nome utilizável. O nome
    -- não é forçado a NOT NULL para não quebrar o fluxo legado de registo
    -- (display_name é opcional na API); o fluxo Google sempre o preenche.
    INSERT INTO host_profiles (host_id, display_name)
    SELECT h.id, split_part(h.email::text, '@', 1)
      FROM hosts h
      LEFT JOIN host_profiles p ON p.host_id = h.id
     WHERE p.host_id IS NULL;

    UPDATE host_profiles p
       SET display_name = split_part(h.email::text, '@', 1)
      FROM hosts h
     WHERE p.host_id = h.id
       AND (p.display_name IS NULL OR btrim(p.display_name) = '');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS hosts_google_id_unique;

    -- Contas criadas apenas com Google não tinham senha. Antes de
    -- repor NOT NULL damos um valor opaco que nunca valida como Argon2.
    UPDATE hosts
       SET password_hash = md5(random()::text || clock_timestamp()::text)
     WHERE password_hash IS NULL;

    ALTER TABLE hosts
      DROP COLUMN IF EXISTS google_id,
      ALTER COLUMN password_hash SET NOT NULL;
  `);
};
