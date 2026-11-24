/**
 * Bloco 14 — convite: manifesto de template, vídeo, localização exata,
 * mesas e rascunhos.
 *
 * - `event_templates.manifest` (jsonb, versão 1) e 6 templates iniciais;
 *   o template `base` recebe um manifesto neutro.
 * - `events.youtube_video_id` (só o ID de 11 caracteres), `latitude`,
 *   `longitude`, `place_label` e `use_tables` (desligado por defeito).
 * - `event_drafts`: rascunhos do assistente, privados do anfitrião (nunca
 *   são eventos: não aparecem no feed, na pesquisa nem têm link).
 *
 * Reversível: `down` remove só o que foi acrescentado.
 */

const ivory = {
  version: 1,
  palette: { bg: '#FBF7EF', surface: '#FFFDF8', ink: '#3A2F1E', accent: '#B8913A', muted: '#8A7A5C' },
  fonts: { display: 'script', body: 'serif' },
  ornaments: { frame: 'thin-gold', corners: 'floral', divider: 'flourish' },
  layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'deadline', 'message'] },
  cover: 'framed',
  open_style: 'envelope',
  pdf: { frame: 'double', qr_position: 'bottom-center', show_ornaments: true },
};

const vows = {
  version: 1,
  palette: { bg: '#F7F1E6', surface: '#FFFBF3', ink: '#2F2618', accent: '#C49A45', muted: '#8C7A58' },
  fonts: { display: 'script', body: 'serif' },
  ornaments: { frame: 'thin-gold', corners: 'roses', divider: 'ribbon' },
  layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'message', 'deadline'] },
  cover: 'hero',
  open_style: 'curtain',
  pdf: { frame: 'double', qr_position: 'bottom-center', show_ornaments: true },
};

const minimal = {
  version: 1,
  palette: { bg: '#FFFFFF', surface: '#FFFFFF', ink: '#111827', accent: '#111827', muted: '#6B7280' },
  fonts: { display: 'sans', body: 'sans' },
  ornaments: { frame: 'none', corners: 'none', divider: 'line' },
  layout: { align: 'left', blocks: ['title', 'datetime', 'location', 'host', 'message', 'deadline'] },
  cover: 'none',
  open_style: 'fade',
  pdf: { frame: 'none', qr_position: 'bottom-right', show_ornaments: false },
};

const worship = {
  version: 1,
  palette: { bg: '#0F1E3D', surface: '#16284D', ink: '#F5EEDC', accent: '#D8B76A', muted: '#A9B3C9' },
  fonts: { display: 'cap', body: 'serif' },
  ornaments: { frame: 'thin-gold', corners: 'rays', divider: 'star' },
  layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'message', 'deadline'] },
  cover: 'framed',
  open_style: 'fade',
  pdf: { frame: 'single', qr_position: 'bottom-center', show_ornaments: true },
};

const party = {
  version: 1,
  palette: { bg: '#FFF4E8', surface: '#FFFFFF', ink: '#2A1240', accent: '#FF4F8B', muted: '#7A5C8F' },
  fonts: { display: 'sans', body: 'sans' },
  ornaments: { frame: 'none', corners: 'blobs', divider: 'dots' },
  layout: { align: 'left', blocks: ['title', 'datetime', 'location', 'message', 'host', 'deadline'] },
  cover: 'hero',
  open_style: 'fold',
  pdf: { frame: 'none', qr_position: 'bottom-right', show_ornaments: true },
};

const sage = {
  version: 1,
  palette: { bg: '#F3F1EA', surface: '#FBFAF5', ink: '#2E3A2F', accent: '#7D9A7E', muted: '#7B8578' },
  fonts: { display: 'serif', body: 'serif' },
  ornaments: { frame: 'thin', corners: 'leaves', divider: 'leaf' },
  layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'deadline', 'message'] },
  cover: 'framed',
  open_style: 'envelope',
  pdf: { frame: 'single', qr_position: 'bottom-center', show_ornaments: true },
};

const base = {
  version: 1,
  palette: { bg: '#FFFFFF', surface: '#FFFFFF', ink: '#1F2937', accent: '#7C5CFF', muted: '#6B7280' },
  fonts: { display: 'sans', body: 'sans' },
  ornaments: { frame: 'none', corners: 'none', divider: 'line' },
  layout: { align: 'left', blocks: ['title', 'host', 'datetime', 'location', 'deadline', 'message'] },
  cover: 'hero',
  open_style: 'fade',
  pdf: { frame: 'single', qr_position: 'bottom-right', show_ornaments: false },
};

const PRESETS = [
  ['marfim-dourado', 'Marfim e Dourado Floral', 'Creme com moldura dourada fina e cantos florais.', ivory, 10],
  ['renovacao-votos', 'Renovação de Votos Dourado', 'Foto do casal no topo a fundir-se em creme, moldura dourada e rosas.', vows, 20],
  ['minimal-branco', 'Minimal Branco', 'Tipografia limpa e muito espaço.', minimal, 30],
  ['culto-louvor', 'Culto e Louvor', 'Azul profundo e dourado suave, para igrejas e ministérios.', worship, 40],
  ['festa-jovem', 'Festa Jovem', 'Cores vibrantes e formas orgânicas, para aniversários e jovens.', party, 50],
  ['jardim-salvia', 'Jardim Verde Sálvia', 'Verde sálvia e creme com folhas finas, para casamentos e batizados.', sage, 60],
];

const FIELDS = ['title', 'host_name', 'starts_at', 'timezone', 'location', 'message', 'rules', 'dress_code', 'contribution'];

exports.up = (pgm) => {
  pgm.addColumns('event_templates', {
    manifest: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
  });
  pgm.sql(`UPDATE event_templates SET manifest = '${JSON.stringify(base)}'::jsonb WHERE slug = 'base'`);
  for (const [slug, name, description, manifest, order] of PRESETS) {
    pgm.sql(`
      INSERT INTO event_templates (slug, name, description, supported_fields, themes, is_active, sort_order, manifest)
      VALUES (
        '${slug}', '${name}', '${description}',
        '${JSON.stringify(FIELDS)}'::jsonb,
        '[{"mode":"light","palette":"default"}]'::jsonb,
        true, ${order}, '${JSON.stringify(manifest)}'::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET manifest = EXCLUDED.manifest, name = EXCLUDED.name, description = EXCLUDED.description
    `);
  }

  pgm.addColumns('events', {
    youtube_video_id: { type: 'text' },
    latitude: { type: 'numeric(9,6)' },
    longitude: { type: 'numeric(9,6)' },
    place_label: { type: 'text' },
    use_tables: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint('events', 'events_youtube_video_id_check', {
    check: `youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'`,
  });
  pgm.addConstraint('events', 'events_coordinates_check', {
    check: `(latitude IS NULL AND longitude IS NULL) OR
            (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)`,
  });
  pgm.addConstraint('events', 'events_place_label_check', {
    check: `place_label IS NULL OR char_length(place_label) <= 200`,
  });

  pgm.createTable('event_drafts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    host_id: { type: 'uuid', notNull: true, references: 'hosts', onDelete: 'CASCADE' },
    title: { type: 'text' },
    step: { type: 'smallint', notNull: true, default: 0 },
    payload: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('event_drafts', 'event_drafts_step_check', { check: 'step BETWEEN 0 AND 20' });
  pgm.addConstraint('event_drafts', 'event_drafts_payload_size_check', {
    check: `pg_column_size(payload) <= 65536`,
  });
  pgm.createIndex('event_drafts', ['host_id', 'updated_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('event_drafts');
  pgm.dropConstraint('events', 'events_place_label_check');
  pgm.dropConstraint('events', 'events_coordinates_check');
  pgm.dropConstraint('events', 'events_youtube_video_id_check');
  pgm.dropColumns('events', ['youtube_video_id', 'latitude', 'longitude', 'place_label', 'use_tables']);
  pgm.sql(`DELETE FROM event_templates WHERE slug IN (${PRESETS.map(([slug]) => `'${slug}'`).join(', ')})
             AND NOT EXISTS (SELECT 1 FROM events e WHERE e.template_id = event_templates.id)`);
  pgm.dropColumns('event_templates', ['manifest']);
};
