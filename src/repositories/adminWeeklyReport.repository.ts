import { query } from '../database/pool';

/** Relatórios globais semanais guardados na base de dados (Bloco 8). */

export interface AdminWeeklyReport {
  id: string;
  week_start: string;
  status: 'generating' | 'ready';
  filename: string;
  size_bytes: number;
  host_count: number;
  generated_at: string | null;
  created_at: string;
}

interface AdminWeeklyReportRow extends Omit<AdminWeeklyReport, 'created_at' | 'generated_at'> {
  created_at: Date | string;
  generated_at: Date | string | null;
  content?: Buffer | null;
}

const COLUMNS = `
  id, week_start, status, filename, size_bytes, host_count, generated_at, created_at
`;

function toReport(row: AdminWeeklyReportRow): AdminWeeklyReport {
  return {
    id: String(row.id),
    week_start: typeof row.week_start === 'string' ? row.week_start : '',
    status: row.status,
    filename: row.filename,
    size_bytes: Number(row.size_bytes ?? 0),
    host_count: Number(row.host_count ?? 0),
    generated_at: row.generated_at
      ? row.generated_at instanceof Date
        ? row.generated_at.toISOString()
        : row.generated_at
      : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export const adminWeeklyReportRepository = {
  /**
   * Reserva uma semana para geração. `ON CONFLICT DO NOTHING` é a
   * "eleição" entre instâncias: só uma recebe o id e faz o trabalho.
   * Uma reserva abandonada há mais de uma hora é reclamada.
   */
  async claim(weekStart: string, filename: string): Promise<string | null> {
    const inserted = await query<{ id: string }>(
      `INSERT INTO admin_weekly_reports (week_start, filename)
       VALUES ($1, $2)
       ON CONFLICT (week_start) DO NOTHING
       RETURNING id`,
      [weekStart, filename]
    );
    const id = inserted.rows[0]?.id;
    if (id) return String(id);

    const reclaimed = await query<{ id: string }>(
      `UPDATE admin_weekly_reports
          SET created_at = now(), filename = $2
        WHERE week_start = $1
          AND status = 'generating'
          AND created_at < now() - interval '1 hour'
        RETURNING id`,
      [weekStart, filename]
    );
    return reclaimed.rows[0] ? String(reclaimed.rows[0].id) : null;
  },

  async markReady(
    id: string,
    content: Buffer,
    generatedAt: Date,
    hostCount: number
  ): Promise<AdminWeeklyReport | null> {
    const result = await query<AdminWeeklyReportRow>(
      `UPDATE admin_weekly_reports
          SET status = 'ready', content = $2::bytea, size_bytes = $3,
              generated_at = $4, host_count = $5
        WHERE id = $1 AND status = 'generating'
        RETURNING ${COLUMNS}`,
      [id, content, content.byteLength, generatedAt, hostCount]
    );
    const row = result.rows[0];
    return row ? toReport(row) : null;
  },

  /** Remove a reserva para que um ciclo seguinte tente outra vez. */
  async discard(id: string): Promise<void> {
    await query(
      `DELETE FROM admin_weekly_reports WHERE id = $1 AND status = 'generating'`,
      [id]
    );
  },

  async list(limit: number): Promise<AdminWeeklyReport[]> {
    const result = await query<AdminWeeklyReportRow>(
      `SELECT ${COLUMNS} FROM admin_weekly_reports
        WHERE status = 'ready'
        ORDER BY week_start DESC
        LIMIT $1`,
      [limit]
    );
    return result.rows.map(toReport);
  },

  async findReady(id: string): Promise<{ report: AdminWeeklyReport; content: Buffer } | null> {
    const result = await query<AdminWeeklyReportRow>(
      `SELECT ${COLUMNS}, content FROM admin_weekly_reports
        WHERE id = $1 AND status = 'ready'`,
      [id]
    );
    const row = result.rows[0];
    if (!row || !row.content) return null;
    return { report: toReport(row), content: row.content };
  },

  /** Apaga semanas mais antigas que o limite de retenção. */
  async prune(olderThan: string): Promise<number> {
    const result = await query<{ id: string }>(
      `DELETE FROM admin_weekly_reports
        WHERE status = 'ready' AND week_start < $1::date
        RETURNING id`,
      [olderThan]
    );
    return result.rowCount ?? 0;
  },
};
