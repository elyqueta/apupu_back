import { env } from './config/env';
import { logger } from './config/logger';
import { closePool } from './database/pool';
import { startOutboxScheduler, stopOutboxScheduler } from './services/outbox.service';

/**
 * Worker dedicado da outbox.
 *
 * Corre separado da API para que o envio de emails (SMTP/HTTP para o
 * fornecedor, renderização de HTML, retries) não dispute o event loop
 * nem as ligações à base de dados com os pedidos HTTP. Pode ser
 * escalado horizontalmente: `FOR UPDATE SKIP LOCKED` garante que duas
 * instâncias não enviam a mesma entrega.
 *
 * Em protótipos com um único processo, `OUTBOX_IN_API=true` mantém o
 * agendador dentro da API. Em produção recomenda-se `OUTBOX_IN_API=false`
 * e este processo sempre ligado.
 */
if (!env.OUTBOX_ENABLED) {
  logger.error(
    'OUTBOX_ENABLED=false: o worker dedicado não foi iniciado. Ativa a variável para processar emails.'
  );
  process.exit(1);
}

logger.info({ nodeEnv: env.NODE_ENV }, 'Worker da outbox a iniciar.');

startOutboxScheduler();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} recebido. A encerrar o worker da outbox...`);
  stopOutboxScheduler();

  try {
    await closePool();
    logger.info('Worker da outbox encerrado.');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao encerrar o worker da outbox.');
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
