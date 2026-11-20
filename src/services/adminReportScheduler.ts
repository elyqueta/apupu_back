import { env } from '../config/env';
import { logger } from '../config/logger';
import { adminReportService, weekStartFor } from './adminReport.service';

/**
 * Agendador do relatório global semanal (Bloco 8).
 *
 * Um ciclo por minuto verifica a hora local de Luanda; a geração em si
 * é idempotente por semana na base de dados, por isso várias instâncias
 * podem correr este agendador em simultâneo sem duplicar PDFs. Não há
 * dependência de bibliotecas de cron.
 */

const CHECK_INTERVAL_MS = 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let timer: NodeJS.Timeout | null = null;
let lastWeek: string | null = null;
let checking = false;

function localParts(now: Date): { hour: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Luanda',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  return {
    hour: Number(parts.hour),
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday ?? 'Sun')),
  };
}

async function tick(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const now = new Date();
    const local = localParts(now);
    if (local.hour !== env.ADMIN_WEEKLY_REPORT_LOCAL_HOUR) return;
    if (local.weekday !== env.ADMIN_WEEKLY_REPORT_LOCAL_WEEKDAY) return;

    const week = weekStartFor(now);
    if (week === lastWeek) return;

    const existing = await adminReportService.listWeeklyReports();
    if (existing.some((report) => report.week_start === week)) {
      lastWeek = week;
      return;
    }

    const report = await adminReportService.generateWeeklyReport(now);
    if (report) lastWeek = week;
  } finally {
    checking = false;
  }
}

export function startAdminReportScheduler(): void {
  if (timer || !env.ADMIN_WEEKLY_REPORT_ENABLED) return;
  timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      logger.error({ err: error }, 'Erro no agendador do relatório semanal.');
    });
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  logger.info(
    {
      weekday: env.ADMIN_WEEKLY_REPORT_LOCAL_WEEKDAY,
      hour: env.ADMIN_WEEKLY_REPORT_LOCAL_HOUR,
      timeZone: 'Africa/Luanda',
    },
    'Agendador do relatório semanal de perfis iniciado.'
  );
}

export function stopAdminReportScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Permite testes sem esperar pelo intervalo. */
export async function runAdminReportTick(): Promise<void> {
  await tick();
}
