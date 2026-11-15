import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { HostTask } from '../types/host.types';

interface TaskRow {
  id: string;
  host_id: string;
  event_id: string | null;
  label: string;
  done: boolean;
  created_at: Date;
  updated_at: Date;
}

function toTask(row: TaskRow): HostTask {
  return {
    id: row.id,
    hostId: row.host_id,
    eventId: row.event_id,
    label: row.label,
    done: row.done,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, host_id, event_id, label, done, created_at, updated_at
`;

export const taskRepository = {
  async create(
    data: { hostId: string; eventId: string | null; label: string },
    client?: PoolClient
  ): Promise<HostTask> {
    const runner = client ?? pool;
    const result = await runner.query<TaskRow>(
      `INSERT INTO host_tasks (host_id, event_id, label)
       VALUES ($1,$2,$3)
       RETURNING ${SELECT_COLUMNS}`,
      [data.hostId, data.eventId, data.label]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar tarefa.');
    return toTask(row);
  },

  async listForHost(hostId: string, eventId?: string): Promise<HostTask[]> {
    const values: unknown[] = [hostId];
    let filter = '';

    if (eventId) {
      values.push(eventId);
      // Inclui as tarefas globais (`event_id IS NULL`) na vista do evento.
      filter = 'AND (event_id = $2 OR event_id IS NULL)';
    }

    const result = await query<TaskRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM host_tasks
        WHERE host_id = $1 ${filter}
        ORDER BY created_at DESC, id DESC`,
      values
    );
    return result.rows.map(toTask);
  },

  async findByIdForHost(id: string, hostId: string): Promise<HostTask | null> {
    const result = await query<TaskRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM host_tasks
        WHERE id = $1 AND host_id = $2`,
      [id, hostId]
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
    }

    if (set.length === 0) {
      return this.findByIdForHost(id, hostId);
    }

    values.push(id, hostId);
    const result = await query<TaskRow>(
      `UPDATE host_tasks
          SET ${set.join(', ')}, updated_at = now()
        WHERE id = $${values.length - 1} AND host_id = $${values.length}
        RETURNING ${SELECT_COLUMNS}`,
      values
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
