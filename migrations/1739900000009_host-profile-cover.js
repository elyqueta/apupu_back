/**
 * Imagem de capa do perfil do anfitrião.
 *
 * - `cover_url` é a imagem apresentada no topo do perfil;
 * - `cover_hash` permite que um novo upload do mesmo ficheiro seja
 *   idempotente (não volta a subir para o Cloudinary);
 * - `cover_public_id` permite remover o asset antigo quando a capa é
 *   substituída ou removida.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_profiles
      ADD COLUMN cover_url text,
      ADD COLUMN cover_hash text,
      ADD COLUMN cover_public_id text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE host_profiles
      DROP COLUMN IF EXISTS cover_public_id,
      DROP COLUMN IF EXISTS cover_hash,
      DROP COLUMN IF EXISTS cover_url;
  `);
};
