import { query } from '../database/pool';

export interface EventDraftRow {
  id: string;
  host_id: string;
  title: string | null;
  step: number;
  payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Bloco 14 — rascunhos do assistente; sempre filtrados pelo anfitrião. */
export const eventDraftRepository = {
  async list(hostId: string): Promise<EventDraftRow[]> {
    const result = await query<EventDraftRow>(
      `SELECT id, host_id, title, step, payload, created_at, updated_at
         FROM event_drafts WHERE host_id = $1 ORDER BY updated_at DESC LIMIT 50`,
      [hostId]
    );
    return result.rows;
  },

  async find(hostId: string, id: string): Promise<EventDraftRow | null> {
    const result = await query<EventDraftRow>(
      `SELECT id, host_id, title, step, payload, created_at, updated_at
         FROM event_drafts WHERE id = $1 AND host_id = $2`,
      [id, hostId]
    );
    return result.rows[0] ?? null;
  },

  async count(hostId: string): Promise<number> {
    const result = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM event_drafts WHERE host_id = $1`,
      [hostId]
    );
    return result.rows[0]?.count ?? 0;
  },

  async create(hostId: string, data: { title: string | null; step: number; payload: unknown }): Promise<EventDraftRow> {
    const result = await query<EventDraftRow>(
      `INSERT INTO event_drafts (host_id, title, step, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, host_id, title, step, payload, created_at, updated_at`,
      [hostId, data.title, data.step, JSON.stringify(data.payload)]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar rascunho.');
    return row;
  },

  async update(hostId: string, id: string, data: { title: string | null; step: number; payload: unknown }): Promise<EventDraftRow | null> {
    const result = await query<EventDraftRow>(
      `UPDATE event_drafts SET title = $3, step = $4, payload = $5::jsonb, updated_at = now()
        WHERE id = $1 AND host_id = $2
        RETURNING id, host_id, title, step, payload, created_at, updated_at`,
      [id, hostId, data.title, data.step, JSON.stringify(data.payload)]
    );
    return result.rows[0] ?? null;
  },

  async remove(hostId: string, id: string): Promise<boolean> {
    const result = await query(`DELETE FROM event_drafts WHERE id = $1 AND host_id = $2`, [id, hostId]);
    return (result.rowCount ?? 0) > 0;
  },
};
