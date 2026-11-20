/**
 * Subscrições de novidades (Bloco 7).
 *
 * O índice único em `lower(email)` torna a inscrição idempotente: o
 * mesmo email (independentemente das maiúsculas) só pode existir uma
 * vez, e a API devolve sempre a mesma resposta. `down` remove a tabela.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email      text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriptions_email_lower_key
      ON newsletter_subscriptions (lower(email));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS newsletter_subscriptions_email_lower_key;
    DROP TABLE IF EXISTS newsletter_subscriptions;
  `);
};
