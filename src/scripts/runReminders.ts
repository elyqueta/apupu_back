import { logger } from '../config/logger';
import { closePool } from '../database/pool';
import { processOutbox } from '../services/outbox.service';

/**
 * Executa um ciclo da outbox manualmente.
 *
 * Útil em cron externo (`* * * * * npm run outbox:run`) ou para
 * depuração, sem esperar pelo agendador interno. O worker envia
 * convites, lembretes, avisos de recusa e cancelamentos.
 */
async function main(): Promise<void> {
  try {
    const result = await processOutbox();
    logger.info(result, 'Ciclo da outbox concluído.');
  } finally {
    await closePool();
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Falha ao executar a outbox.');
  process.exitCode = 1;
});
