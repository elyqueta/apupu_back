/**
 * Bloco 15, Passo 5: foto de equipa.
 *
 * Foto opcional guardada no Cloudinary; public_id permite remoção/substituição.
 */
exports.up = (pgm) => {
  pgm.addColumns('teams', {
    photo_url: { type: 'text' },
    photo_public_id: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('teams', ['photo_url', 'photo_public_id']);
};
