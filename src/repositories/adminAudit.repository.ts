import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';

/**
 * Auditoria das acções do super admin.
 *
 * Append-only: não existem métodos de edição ou remoção. A retenção é
 * feita por política de base de dados fora desta aplicação.
 */
export interface AdminAuditEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface AdminAuditRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

const SELECT_COLUMNS = `
  id, admin_id, action, target_type, target_id, reason, metadata, created_at
`;

function toEntry(row: AdminAuditRow): AdminAuditEntry {
  return {
    id: row.id,
    adminId: row.admin_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export interface AdminAuditFilters {
  q?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AdminAuditList {
  items: AdminAuditEntry[];
  total: number;
}

export const adminAuditRepository = {
  async record(
    entry: {
      adminId: string;
      action: string;
      targetType?: string | null;
      targetId?: string | null;
      reason?: string | null;
      metadata?: Record<string, unknown>;
    },
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `INSERT INTO admin_audit_log
         (admin_id, action, target_type, target_id, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        entry.adminId,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.reason ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ]
    );
  },

  async list(filters: AdminAuditFilters): Promise<AdminAuditList> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown): void => {
      params.push(value);
      clauses.push(sql.replace('?', `$${params.length}`));
    };

    if (filters.q) push('action ILIKE ?', `%${filters.q}%`);
    if (filters.action) push('action = ?', filters.action);
    if (filters.from) push('created_at >= ?', filters.from);
    if (filters.to) push('created_at <= ?', filters.to);

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const base = `FROM admin_audit_log${where}`;

    const [items, count] = await Promise.all([
      query<AdminAuditRow>(
        `SELECT ${SELECT_COLUMNS} ${base} ORDER BY created_at DESC LIMIT $${
          params.length + 1
        } OFFSET $${params.length + 2}`,
        [...params, filters.limit, filters.offset]
      ),
      query<{ count: string }>(`SELECT count(*)::text AS count ${base}`, params),
    ]);

    return {
      items: items.rows.map(toEntry),
      total: Number(count.rows[0]?.count ?? 0),
    };
  },

  async recent(limit: number): Promise<AdminAuditEntry[]> {
    const result = await query<AdminAuditRow>(
      `SELECT ${SELECT_COLUMNS} FROM admin_audit_log ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(toEntry);
  },
};
