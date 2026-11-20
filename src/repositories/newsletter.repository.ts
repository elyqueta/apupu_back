import { pool, query } from '../database/pool';
import { NewsletterSubscription } from '../types/newsletter.types';
import { escapeLike } from '../utils/like.util';

interface NewsletterRow {
  id: string;
  email: string;
  created_at: Date;
}

const SELECT_COLUMNS = 'id, email, created_at';

function toSubscription(row: NewsletterRow): NewsletterSubscription {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export interface NewsletterListFilters {
  q?: string;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

export type NewsletterExportFilters = Omit<NewsletterListFilters, 'offset' | 'limit'>;

function buildWhere(filters: NewsletterExportFilters): { where: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  const push = (sql: string, value: unknown): void => {
    values.push(value);
    clauses.push(sql.replace('?', `$${values.length}`));
  };

  if (filters.q) {
    push('email ILIKE ? ESCAPE \'\\\'', `%${escapeLike(filters.q)}%`);
  }
  if (filters.from) push('created_at >= ?', filters.from);
  if (filters.to) push('created_at <= ?', filters.to);

  return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}

/**
 * Persistência das subscrições de novidades.
 *
 * A igualdade é feita por `lower(email)`, o mesmo índice único usado na
 * migração. `INSERT ... ON CONFLICT ... DO NOTHING` não altera a data de
 * subscrição original nem revela se o email já estava na lista.
 */
export const newsletterRepository = {
  async subscribe(email: string): Promise<void> {
    await pool.query(
      `INSERT INTO newsletter_subscriptions (email)
       VALUES ($1)
       ON CONFLICT (lower(email)) DO NOTHING`,
      [email]
    );
  },

  async list(filters: NewsletterListFilters): Promise<{ items: NewsletterSubscription[]; total: number }> {
    const { where, values } = buildWhere(filters);
    const base = `FROM newsletter_subscriptions${where}`;
    const listValues = [...values, filters.limit, filters.offset];

    const [items, count] = await Promise.all([
      query<NewsletterRow>(
        `SELECT ${SELECT_COLUMNS} ${base}
          ORDER BY created_at DESC, id DESC
          LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues
      ),
      query<{ total: string }>(`SELECT count(*)::text AS total ${base}`, values),
    ]);

    return {
      items: items.rows.map(toSubscription),
      total: Number(count.rows[0]?.total ?? '0'),
    };
  },

  /** Mesmos filtros da lista, sem paginação, para exportação CSV. */
  async listForExport(filters: NewsletterExportFilters): Promise<NewsletterSubscription[]> {
    const { where, values } = buildWhere(filters);
    const result = await query<NewsletterRow>(
      `SELECT ${SELECT_COLUMNS} FROM newsletter_subscriptions${where}
        ORDER BY created_at DESC, id DESC`,
      values
    );
    return result.rows.map(toSubscription);
  },

  async remove(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM newsletter_subscriptions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },
};
