/**
 * Bloco 15, Passo 1.1: template "Gratitude" (sistema).
 *
 * Adiciona `kind` a `event_templates` (system|user, default user) e
 * insere o template Gratitude como oficial da plataforma.
 * Reversível: remove Gratitude e a coluna kind.
 */

const gratitude = {
  version: 1,
  palette: {
    bg: '#FFF6EA',
    surface: '#FFFDF8',
    ink: '#1A120B',
    accent: '#C8922A',
    muted: '#7A6248',
  },
  fonts: { display: 'condensed', body: 'sans' },
  ornaments: { frame: 'gratitude', corners: 'gratitude', divider: 'gratitude' },
  layout: {
    align: 'center',
    blocks: ['title', 'host', 'datetime', 'location', 'message'],
  },
  cover: 'none',
  open_style: 'fade',
  pdf: {
    frame: 'none',
    qr_position: 'bottom-right',
    show_ornaments: true,
    qr_label: 'Informação',
    qr_destination: 'event',
  },
};

const FIELDS = [
  'title',
  'host_name',
  'starts_at',
  'timezone',
  'location',
  'message',
  'dress_code',
];

exports.up = (pgm) => {
  pgm.addColumns('event_templates', {
    kind: { type: 'text', notNull: true, default: "'user'" },
  });
  pgm.addConstraint('event_templates', 'event_templates_kind_check', {
    check: "kind IN ('system', 'user')",
  });

  pgm.sql(`
    INSERT INTO event_templates (slug, name, description, supported_fields, themes, is_active, sort_order, manifest, kind)
    VALUES (
      'gratitude',
      'Gratitude',
      'Template Gratitude inspirado em celebrações africanas, com padrão geométrico e destaque dourado.',
      '${JSON.stringify(FIELDS)}'::jsonb,
      '[{"mode":"light","palette":"gratitude"}]'::jsonb,
      true, 5,
      '${JSON.stringify(gratitude)}'::jsonb,
      'system'
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      supported_fields = EXCLUDED.supported_fields,
      themes = EXCLUDED.themes,
      is_active = EXCLUDED.is_active,
      sort_order = EXCLUDED.sort_order,
      manifest = EXCLUDED.manifest,
      kind = EXCLUDED.kind
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM event_templates WHERE slug = 'gratitude' AND kind = 'system' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.template_id = event_templates.id)`);
  pgm.dropConstraint('event_templates', 'event_templates_kind_check');
  pgm.dropColumns('event_templates', ['kind']);
};
