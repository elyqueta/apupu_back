import { env } from '../config/env';
import { logger } from '../config/logger';
import { withTransaction } from '../database/pool';
import { retentionRepository } from '../repositories/retention.repository';
import { subtractMonths } from '../utils/date.util';

export interface RetentionRunOptions {
  months?: number;
  batchSize?: number;
  now?: Date;
}

export interface RetentionRunResult {
  months: number;
  batch_size: number;
  cutoff: string;
  batches: number;
  hosts_deleted: number;
  events_detached: number;
  verifications_deleted: number;
  duration_ms: number;
}

/**
 * Job de retenção de contas.
 *
 * Elimina contas sem login durante `ACCOUNT_RETENTION_MONTHS` meses.
 * O corte usa `COALESCE(last_login_at, created_at)`, pelo que contas
 * criadas e nunca usadas também são abrangidas. Cada lote corre numa
 * transacção própria, mantendo locks curtos e permitindo retomar de
 * forma idempotente se o processo for interrompido.
 *
 * O resumo regista apenas contagens — nunca emails, nomes ou outros
 * dados pessoais.
 */
export const retentionService = {
  async run(options: RetentionRunOptions = {}): Promise<RetentionRunResult> {
    const months = options.months ?? env.ACCOUNT_RETENTION_MONTHS;
    const batchSize = options.batchSize ?? env.RETENTION_BATCH_SIZE;
    const now = options.now ?? new Date();
    const cutoff = subtractMonths(now, months);
    const startedAt = Date.now();

    let batches = 0;
    let hostsDeleted = 0;
    let eventsDetached = 0;
    let verificationsDeleted = 0;

    for (;;) {
      const result = await withTransaction((client) =>
        retentionRepository.deleteInactiveBatch(cutoff, batchSize, client)
      );

      batches += 1;
      hostsDeleted += result.hostsDeleted;
      eventsDetached += result.eventsDetached;
      verificationsDeleted += result.verificationsDeleted;

      logger.debug(
        {
          batch: batches,
          hosts_deleted: result.hostsDeleted,
          events_detached: result.eventsDetached,
        },
        'Lote de retenção concluído.'
      );

      if (result.hostsDeleted < batchSize) break;
    }

    const summary: RetentionRunResult = {
      months,
      batch_size: batchSize,
      cutoff: cutoff.toISOString(),
      batches,
      hosts_deleted: hostsDeleted,
      events_detached: eventsDetached,
      verifications_deleted: verificationsDeleted,
      duration_ms: Date.now() - startedAt,
    };

    logger.info(summary, 'Retenção de contas concluída.');
    return summary;
  },
};
