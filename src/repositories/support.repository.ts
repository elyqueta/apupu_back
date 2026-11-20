import { pool, query } from '../database/pool';
import {
  CreateSupportMessageInput,
  SupportMessage,
  SupportMessageStatus,
} from '../types/support.types';
import { escapeLike } from '../utils/like.util';

interface SupportMessageRow {
  id: string;
  name: string;
  email: string;
  message: string;
  status: SupportMessageStatus;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `
  id, name, email, message, status, resolved_at, resolved_by, created_at, updated_at
`;

function toSupportMessage(row: SupportMessageRow): SupportMessage {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    message: row.message,
    status: row.status,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SupportListFilters {
  q?: string;
  status?: 'open' | 'resolved' | 'all';
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

/** Persistência das mensagens de apoio; nunca expõe SQL ao cliente. */
export const supportRepository = {
  async create(data: CreateSupportMessageInput): Promise<SupportMessage> {
    const result = await query<SupportMessageRow>(
      `INSERT INTO support_messages (name, email, message)
       VALUES ($1, $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [data.name, data.email, data.message]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao registar a mensagem: nenhuma linha devolvida.');
    return toSupportMessage(row);
  },

  async findById(id: string): Promise<SupportMessage | null> {
    const result = await query<SupportMessageRow>(
      `SELECT ${SELECT_COLUMNS} FROM support_messages WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toSupportMessage(row) : null;
  },

  async list(filters: SupportListFilters): Promise<{ items: SupportMessage[]; total: number }> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    const push = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };

    if (filters.q) {
      values.push(`%${escapeLike(filters.q)}%`);
      clauses.push(
        `(name ILIKE $${values.length} ESCAPE '\\' OR ` +
          `email ILIKE $${values.length} ESCAPE '\\' OR ` +
          `message ILIKE $${values.length} ESCAPE '\\')`
      );
    }
    if (filters.status === 'open' || filters.status === 'resolved') {
      push('status = ?', filters.status);
    }
    if (filters.from) push('created_at >= ?', filters.from);
    if (filters.to) push('created_at <= ?', filters.to);

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const base = `FROM support_messages${where}`;
    const listValues = [...values, filters.limit, filters.offset];

    const [items, count] = await Promise.all([
      query<SupportMessageRow>(
        `SELECT ${SELECT_COLUMNS} ${base}
          ORDER BY created_at DESC, id DESC
          LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues
      ),
      query<{ total: string }>(`SELECT count(*)::text AS total ${base}`, values),
    ]);

    return {
      items: items.rows.map(toSupportMessage),
      total: Number(count.rows[0]?.total ?? '0'),
    };
  },

  /**
   * Marca como resolvida. Repetir a chamada devolve a mesma linha, com
   * `resolved_at` e `resolved_by` originais — a operação é idempotente.
   */
  async resolve(id: string, adminId: string): Promise<SupportMessage | null> {
    const result = await pool.query<SupportMessageRow>(
      `UPDATE support_messages
          SET status = 'resolved',
              resolved_at = COALESCE(resolved_at, now()),
              resolved_by = COALESCE(resolved_by, $2),
              updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [id, adminId]
    );
    const row = result.rows[0];
    return row ? toSupportMessage(row) : null;
  },
};
