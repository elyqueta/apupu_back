/**
 * Guarda o identificador do avatar no Cloudinary.
 *
 * O avatar vivia apenas como URL em `host_profiles` (o plano chama-lhe
 * `hosts`, mas o código real mantém o perfil numa tabela própria). Sem
 * `public_id` não era possível remover o asset anterior nem distinguir
 * avatares órfãos na limpeza periódica.
 *
 * O backfill é não destrutivo: só preenche quando a URL aponta para o
 * cloud e a pasta de avatares configurados; outros perfis ficam com
 * `NULL`. `down` remove apenas as duas colunas novas.
 */
const DEFAULT_AVATAR_FOLDER = 'conta-comigo/avatars';
const SAFE_CLOUD_NAME = /^[A-Za-z0-9_-]+$/;
const SAFE_FOLDER = /^[A-Za-z0-9_/-]+$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_profiles
      ADD COLUMN IF NOT EXISTS avatar_public_id text,
      ADD COLUMN IF NOT EXISTS avatar_hash text;
  `);

  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME ?? '').trim();
  const folder = (process.env.CLOUDINARY_AVATAR_FOLDER ?? DEFAULT_AVATAR_FOLDER).trim();

  if (!SAFE_CLOUD_NAME.test(cloudName) || !SAFE_FOLDER.test(folder)) return;

  // Corresponde ao formato devolvido por `uploadImage`: sem
  // transformções, com versão opcional e extensão no nome do ficheiro.
  const pattern =
    `^https://res\\.cloudinary\\.com/${cloudName}/image/upload/` +
    `(?:v[0-9]+/)?${escapeRegExp(folder)}/([^/?#]+)$`;

  pgm.sql(
    `
      UPDATE host_profiles p
         SET avatar_public_id = regexp_replace((regexp_match(p.avatar_url, {pattern}))[1], '\\.[^.]+$', '')
       WHERE p.avatar_public_id IS NULL
         AND p.avatar_url ~ {pattern};
    `,
    { pattern }
  );
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_profiles
      DROP COLUMN IF EXISTS avatar_public_id,
      DROP COLUMN IF EXISTS avatar_hash;
  `);
};
