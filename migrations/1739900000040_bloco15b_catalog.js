/**
 * Bloco 15B — catálogo inicial de templates de sistema (T01–T19).
 *
 * Fonte: src/assets/templates/system-templates.json (espelho do catálogo
 * canónico do front). `up` é um upsert idempotente por slug e nunca altera
 * templates com outros slugs; `down` remove apenas estes 19 quando não
 * estão em uso, sem tocar na coluna `kind` nem noutros templates.
 *
 * Nota de fidelidade: o PDF continua a usar o renderizador genérico v2;
 * ornamentos decorativos complexos (papel enrolado, relevo 3D, máscaras
 * de gradiente) são aproximados no convite digital e não são reproduzidos
 * no PDF ponto-a-ponto. O documento de blocos é o contrato comum.
 */

const catalog = require('../src/assets/templates/system-templates.json');

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonLiteral(value) {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

const slugs = catalog.map((entry) => sqlLiteral(entry.slug)).join(', ');
const defaultThemes = jsonLiteral([{ mode: 'light', palette: 'default' }]);

exports.up = (pgm) => {
  for (const entry of catalog) {
    pgm.sql(`
      INSERT INTO event_templates
        (slug, name, description, supported_fields, themes, is_active, sort_order, manifest, kind)
      VALUES (
        ${sqlLiteral(entry.slug)},
        ${sqlLiteral(entry.name)},
        ${sqlLiteral(entry.description)},
        ${jsonLiteral(entry.supportedFields)},
        ${defaultThemes},
        true,
        ${Number(entry.sortOrder)},
        ${jsonLiteral(entry.manifest)},
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
        kind = 'system'
    `);
  }
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM event_templates
     WHERE slug IN (${slugs})
       AND kind = 'system'
       AND NOT EXISTS (
         SELECT 1 FROM events e WHERE e.template_id = event_templates.id
       )
  `);
};
