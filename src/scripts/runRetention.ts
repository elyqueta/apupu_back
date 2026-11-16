import { logger } from '../config/logger';
import { closePool } from '../database/pool';
import { retentionService } from '../services/retention.service';

/**
 * Executa um ciclo de retenção de contas inactivas.
 *
 * Recomendado em cron diário, por exemplo:
 *
 * ```
 * 0 3 * * * cd /srv/conta-comigo && npm run retention:run
 * ```
 *
 * O processo é idempotente: se for interrompido, a execução seguinte
 * continua a partir das contas que ainda restarem.
 */
async function main(): Promise<void> {
  try {
    await retentionService.run();
  } finally {
    await closePool();
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Falha ao executar a retenção de contas.');
  process.exitCode = 1;
});
