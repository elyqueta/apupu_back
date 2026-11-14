import { logger } from '../../config/logger';
import { pool, closePool } from '../../database/pool';

/**
 * Seed de infraestrutura de templates.
 *
 * Não cria templates visuais finais: esses serão fornecidos pelo
 * responsável do produto. Apenas garante um template neutro para que o
 * fluxo de criação de eventos possa ser testado ponta a ponta.
 */
async function seedTemplates(): Promise<void> {
  await pool.query(
    `INSERT INTO event_templates (
       slug, name, description, supported_fields, themes, is_active, sort_order
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, true, 0)
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           supported_fields = EXCLUDED.supported_fields,
           themes = EXCLUDED.themes,
           is_active = EXCLUDED.is_active,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()`,
    [
      'base',
      'Base',
      'Template neutro de infraestrutura. Substituir pelos templates finais fornecidos pelo responsável.',
      JSON.stringify([
        'title',
        'host_name',
        'starts_at',
        'timezone',
        'location',
        'message',
        'rules',
        'dress_code',
        'contribution',
      ]),
      JSON.stringify([
        { mode: 'light', palette: 'default' },
        { mode: 'dark', palette: 'default' },
      ]),
    ]
  );

  logger.info('Template base garantido.');
}

async function main(): Promise<void> {
  try {
    await seedTemplates();
    logger.info('Seeds concluídos.');
  } finally {
    await closePool();
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Falha ao executar seeds.');
  process.exitCode = 1;
});
