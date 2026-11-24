import { logger } from '../config/logger';
import { eventRepository } from '../repositories/event.repository';

/**
 * Bloco 15, Passo 1.4: marca automaticamente eventos terminados como `completed`.
 * Corre a cada 15 minutos; a derivação na leitura garante correção mesmo antes do job.
 */
const CHECK_INTERVAL_MS = 15 * 60_000;

let timer: NodeJS.Timeout | null = null;
let checking = false;

async function tick(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const updated = await eventRepository.markEndedEventsCompleted();
    if (updated > 0) {
      logger.info({ updated }, 'Eventos terminados marcados como completed.');
    }
  } finally {
    checking = false;
  }
}

export function startEventCompletionScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      logger.error({ err: error }, 'Erro no agendador de conclusão de eventos.');
    });
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  void tick().catch((error: unknown) => {
    logger.error({ err: error }, 'Erro na verificação inicial de conclusão de eventos.');
  });
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, 'Agendador de conclusão de eventos iniciado.');
}

export function stopEventCompletionScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export async function runEventCompletionTick(): Promise<void> {
  await tick();
}
