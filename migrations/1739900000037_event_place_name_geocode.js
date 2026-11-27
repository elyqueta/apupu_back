/**
 * Bloco 15 Task B: nome do local para geocoding/mapa.
 *
 * `place_name` complementa `place_label` (0033) como rótulo legível do ponto.
 * Latitude/longitude já existem (0033) com constraint both-or-neither.
 */
exports.up = (pgm) => {
  pgm.addColumn('events', {
    place_name: { type: 'text' },
  });
  pgm.sql(`UPDATE events SET place_name = place_label WHERE place_name IS NULL AND place_label IS NOT NULL`);
  pgm.addConstraint('events', 'events_place_name_check', {
    check: `place_name IS NULL OR char_length(place_name) <= 200`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('events', 'events_place_name_check');
  pgm.dropColumn('events', 'place_name');
};
