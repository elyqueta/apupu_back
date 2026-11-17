import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { HostTask } from '../types/host.types';

interface TaskRow {
  id: string;
  host_id: string;
  event_id: string | null;
  event_title: string | null;
  manager_id: string | null;
  manager_email: string | null;
  label: string;
  done: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toTask(row: TaskRow): HostTask {
  return {
    id: row.id,
    hostId: row.host_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    managerId: row.manager_id,
    managerEmail: row.manager_email,
    label: row.label,
    done: row.done,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  t.id, t.host_id, t.event_id, t.manager_id, t.label, t.done,
  t.completed_at, t.created_at, t.updated_at,
  e.title AS event_title,
  m.email AS manager_email
`;

const FROM_TASKS = `
  FROM host_tasks t
  LEFT JOIN events e ON e.id = t.event_id
  LEFT JOIN event_managers m ON m.id = t.manager_id
`;

export interface TaskListFilters {
  /** Conta autenticada: proprietária ou gestora (ou ambas). */
  hostId: string;
  /** Email verificado da conta; permite ver tarefas atribuídas. */
  managerEmail?: string | null;
  eventId?: string;
  status: 'all' | 'pending' | 'done';
  assignee: 'all' | 'host' | 'manager';
  managerFilterId?: string;
  q?: string;
  offset: number;
  limit: number;
}

export const taskRepository = {
  async create(
    data: {
      hostId: string;
      eventId: string | null;
      managerId: string | null;
      label: string;
    },
    client?: PoolClient
  ): Promise<HostTask> {
    const runner = client ?? pool;
    const result = await runner.query<TaskRow>(
      `WITH inserted AS (
         INSERT INTO host_tasks (host_id, event_id, manager_id, label)
         VALUES ($1,$2,$3,$4)
         RETURNING *
       )
       SELECT ${SELECT_COLUMNS}
         FROM inserted t
         LEFT JOIN events e ON e.id = t.event_id
         LEFT JOIN event_managers m ON m.id = t.manager_id`,
      [data.hostId, data.eventId, data.managerId, data.label]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar tarefa.');
    return toTask(row);
  },

  async listForHost(
    filters: TaskListFilters
  ): Promise<{ items: HostTask[]; total: number }> {
    const values: unknown[] = [];
    const conditions: string[] = [];

    values.push(filters.hostId);
    const hostParam = values.length;

    if (filters.managerEmail) {
      values.push(filters.managerEmail);
      const emailParam = values.length;
      conditions.push(
        `(t.host_id = $${hostParam} OR (
           m.email = $${emailParam}::citext
           AND m.revoked_at IS NULL
           AND t.event_id IS NOT NULL
         ))`
      );
    } else {
      conditions.push(`t.host_id = $${hostParam}`);
    }

    if (filters.eventId) {
      values.push(filters.eventId);
      // Na vista do evento, as tarefas globais continuam visíveis para
      // o anfitrião. Para gestores só existem tarefas do evento.
      conditions.push(
        filters.managerEmail
          ? `(t.event_id = $${values.length} OR (t.host_id = $${hostParam} AND t.event_id IS NULL))`
          : `(t.event_id = $${values.length} OR t.event_id IS NULL)`
      );
    }

    if (filters.status === 'pending') conditions.push('t.done = false');
    if (filters.status === 'done') conditions.push('t.done = true');
    if (filters.assignee === 'host') conditions.push('t.manager_id IS NULL');
    if (filters.assignee === 'manager') conditions.push('t.manager_id IS NOT NULL');

    if (filters.managerFilterId) {
      values.push(filters.managerFilterId);
      conditions.push(`t.manager_id = $${values.length}`);
    }

    if (filters.q) {
      values.push(`%${filters.q}%`);
      conditions.push(
        `(t.label ILIKE $${values.length} OR e.title ILIKE $${values.length} OR m.email ILIKE $${values.length})`
      );
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
       ${FROM_TASKS}
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<TaskRow>(
      `SELECT ${SELECT_COLUMNS}
       ${FROM_TASKS}
        WHERE ${where}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toTask),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async findByIdForHost(id: string, hostId: string): Promise<HostTask | null> {
    const result = await query<TaskRow>(
      `SELECT ${SELECT_COLUMNS}
       ${FROM_TASKS}
        WHERE t.id = $1 AND t.host_id = $2`,
      [id, hostId]
    );
    const row = result.rows[0];
    return row ? toTask(row) : null;
  },

  async findByIdForManager(id: string, managerEmail: string): Promise<HostTask | null> {
    const result = await query<TaskRow>(
      `SELECT ${SELECT_COLUMNS}
       ${FROM_TASKS}
        WHERE t.id = $1
          AND m.email = $2::citext
          AND m.revoked_at IS NULL
          AND t.event_id IS NOT NULL`,
      [id, managerEmail]
    );
    const row = result.rows[0];
    return row ? toTask(row) : null;
  },

  async update(
    id: string,
    hostId: string,
    changes: { label?: string; done?: boolean }
  ): Promise<HostTask | null> {
    const set: string[] = [];
    const values: unknown[] = [];

    if (changes.label !== undefined) {
      values.push(changes.label);
      set.push(`label = $${values.length}`);
    }
    if (changes.done !== undefined) {
      values.push(changes.done);
      set.push(`done = $${values.length}`);
      set.push(`completed_at = CASE WHEN $${values.length} THEN now() ELSE NULL END`);
    }

    if (set.length === 0) {
      return this.findByIdForHost(id, hostId);
    }

    values.push(id, hostId);
    const result = await query<TaskRow>(
      `WITH updated AS (
         UPDATE host_tasks
            SET ${set.join(', ')}, updated_at = now()
          WHERE id = $${values.length - 1} AND host_id = $${values.length}
          RETURNING *
       )
       SELECT ${SELECT_COLUMNS}
         FROM updated t
         LEFT JOIN events e ON e.id = t.event_id
         LEFT JOIN event_managers m ON m.id = t.manager_id`,
      values
    );
    const row = result.rows[0];
    return row ? toTask(row) : null;
  },

  /** Um gestor só pode marcar como cumprida/pendente. */
  async setDoneForManager(
    id: string,
    managerEmail: string,
    done: boolean
  ): Promise<HostTask | null> {
    const result = await query<TaskRow>(
      `WITH target AS (
         SELECT t.id
           FROM host_tasks t
           JOIN event_managers m ON m.id = t.manager_id
          WHERE t.id = $1
            AND m.email = $2::citext
            AND m.revoked_at IS NULL
            AND t.event_id IS NOT NULL
       ),
       updated AS (
         UPDATE host_tasks t
            SET done = $3,
                completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
                updated_at = now()
           FROM target
          WHERE t.id = target.id
          RETURNING t.*
       )
       SELECT ${SELECT_COLUMNS}
         FROM updated t
         LEFT JOIN events e ON e.id = t.event_id
         LEFT JOIN event_managers m ON m.id = t.manager_id`,
      [id, managerEmail, done]
    );
    const row = result.rows[0];
    return row ? toTask(row) : null;
  },

  async delete(id: string, hostId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM host_tasks WHERE id = $1 AND host_id = $2',
      [id, hostId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
