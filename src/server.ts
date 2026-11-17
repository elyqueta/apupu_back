import app from './app';
import { env } from './config/env';
import { closePool } from './database/pool';
import { logger } from './config/logger';
import { startOutboxScheduler, stopOutboxScheduler } from './services/outbox.service';

const server = app.listen(env.PORT, () => {
  logger.info(`Conto Contigo Backend a correr em http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

if (env.OUTBOX_ENABLED) {
  startOutboxScheduler();
}

/**
 * Shutdown gracioso.
 *
 * A função é síncrona porque `server.close` espera um callback. A
 * parte assíncrona (fechar o pool) é tratada com `.then/.catch` para
 * não deixar promises soltas.
 */
function shutdown(signal: string): void {
  logger.info(`${signal} recebido. A encerrar graciosamente...`);
  stopOutboxScheduler();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Erro ao fechar servidor HTTP');
      process.exit(1);
      return;
    }

    closePool()
      .then(() => {
        logger.info('Servidor e pool de conexões encerrados.');
        process.exit(0);
      })
      .catch((closeErr: unknown) => {
        logger.error({ err: closeErr }, 'Erro ao fechar pool de conexões');
        process.exit(1);
      });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
