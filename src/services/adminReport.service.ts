import { Readable } from 'node:stream';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { NotFoundError } from '../errors';
import { adminAuditRepository } from '../repositories/adminAudit.repository';
import {
  adminProfileRepository,
  AdminProfileEvent,
  AdminProfileTeam,
} from '../repositories/adminProfile.repository';
import {
  adminWeeklyReportRepository,
  AdminWeeklyReport,
} from '../repositories/adminWeeklyReport.repository';
import {
  hostRepository,
  AdminUserListItem,
  toAdminUserListItem,
} from '../repositories/host.repository';
import { ReportExport } from './reportExport.service';
import {
  adminProfilePdfFilename,
  adminWeeklyPdfFilename,
  renderAdminAllProfilesPdf,
  renderAdminProfilePdf,
} from './pdf/adminProfileDocument';

/**
 * Relatórios PDF do painel admin e relatório global semanal (Bloco 8).
 *
 * O job não envia emails: os PDFs ficam na base de dados e são
 * descarregados a partir do `/admin`. A geração é idempotente por
 * semana (`UNIQUE (week_start)`), mesmo com várias instâncias.
 */

const DETAIL_LIMIT = 50;

function pdfExport(body: Buffer, filename: string): ReportExport {
  return {
    filename,
    contentType: 'application/pdf',
    stream: Readable.from([body], { objectMode: false }),
  };
}

/** Segunda-feira da semana de `now` no fuso de Luanda, como `AAAA-MM-DD`. */
export function weekStartFor(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Luanda',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  const local = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12)
  );
  const offset = (local.getUTCDay() - env.ADMIN_WEEKLY_REPORT_LOCAL_WEEKDAY + 7) % 7;
  local.setUTCDate(local.getUTCDate() - offset);
  return local.toISOString().slice(0, 10);
}

function retentionCutoff(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - env.ADMIN_WEEKLY_REPORT_RETENTION_WEEKS * 7);
  return date.toISOString().slice(0, 10);
}

async function buildUserReport(
  userId: string,
  generatedAt: Date
): Promise<{
  user: AdminUserListItem;
  events: AdminProfileEvent[];
  teams: AdminProfileTeam[];
  generatedAt: Date;
}> {
  const host = await hostRepository.findById(userId);
  if (!host) throw new NotFoundError('Utilizador não encontrado.', 'user_not_found');

  const [events, teams] = await Promise.all([
    adminProfileRepository.eventsForUser(userId, DETAIL_LIMIT),
    adminProfileRepository.teamsForUser(userId, DETAIL_LIMIT),
  ]);

  return {
    user: toAdminUserListItem(host),
    events,
    teams,
    generatedAt,
  };
}

export const adminReportService = {
  /** PDF individual, com os mesmos dados do detalhe do painel. */
  async userReport(adminId: string, userId: string): Promise<ReportExport> {
    const generatedAt = new Date();
    const data = await buildUserReport(userId, generatedAt);

    await adminAuditRepository.record({
      adminId,
      action: 'admin_user_report_exported',
      targetType: 'host',
      targetId: userId,
    });

    return pdfExport(
      await renderAdminProfilePdf(data, generatedAt),
      adminProfilePdfFilename(data.user, generatedAt)
    );
  },

  /** PDF global imediato; usa exactamente o mesmo renderizador do job. */
  async allUsersReport(adminId: string): Promise<ReportExport> {
    const generatedAt = new Date();
    const users = await adminProfileRepository.allUsersForReport();

    await adminAuditRepository.record({
      adminId,
      action: 'admin_all_users_report_exported',
      targetType: 'admin',
      targetId: adminId,
      metadata: { hosts: users.length },
    });

    return pdfExport(
      await renderAdminAllProfilesPdf(users, generatedAt),
      adminWeeklyPdfFilename(generatedAt)
    );
  },

  /** Lista de PDFs semanais prontos para download, mais recente primeiro. */
  async listWeeklyReports(): Promise<AdminWeeklyReport[]> {
    return adminWeeklyReportRepository.list(env.ADMIN_WEEKLY_REPORT_RETENTION_WEEKS);
  },

  async getWeeklyReport(reportId: string): Promise<{ report: AdminWeeklyReport; content: Buffer }> {
    const found = await adminWeeklyReportRepository.findReady(reportId);
    if (!found) throw new NotFoundError('Relatório não encontrado.', 'report_not_found');
    return found;
  },

  /**
   * Gera o relatório da semana corrente. Não audita: o agendador não
   * corre com sessão de super admin (o admin_id da auditoria é uma FK).
   */
  async generateWeeklyReport(now: Date = new Date()): Promise<AdminWeeklyReport | null> {
    const weekStart = weekStartFor(now);
    const filename = adminWeeklyPdfFilename(now);
    const id = await adminWeeklyReportRepository.claim(weekStart, filename);
    if (!id) {
      logger.info({ weekStart }, 'Relatório semanal já gerado; nada a fazer.');
      return null;
    }

    try {
      const users = await adminProfileRepository.allUsersForReport();
      const content = await renderAdminAllProfilesPdf(users, now);
      const report = await adminWeeklyReportRepository.markReady(id, content, now, users.length);
      const discarded = await adminWeeklyReportRepository.prune(retentionCutoff(weekStart));
      logger.info(
        { weekStart, hosts: users.length, bytes: content.byteLength, discarded },
        'Relatório semanal de perfis gerado.'
      );
      return report;
    } catch (error) {
      await adminWeeklyReportRepository.discard(id);
      logger.error({ err: error, weekStart }, 'Falha ao gerar relatório semanal.');
      throw error;
    }
  },
};
