import { logger } from '../config/logger';
import { closePool } from '../database/pool';
import { adminReportService } from '../services/adminReport.service';

/**
 * Gera o relatório global semanal de perfis fora do processo HTTP.
 *
 * Útil para cron externo e para repor uma semana falhada: a operação é
 * idempotente, porque a semana é única na base de dados.
 *
 * ```
 * 0 9 * * 1 cd /srv/conto-comigo && npm run admin-report:run
 * ```
 */
async function main(): Promise<void> {
  const report = await adminReportService.generateWeeklyReport();
  logger.info(
    { id: report?.id ?? null, weekStart: report?.week_start ?? null },
    'Ciclo manual do relatório semanal concluído.'
  );
}

void main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Falha ao gerar relatório semanal.');
    process.exitCode = 1;
  })
  .finally(() => closePool());
