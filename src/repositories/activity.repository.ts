import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  ActivityKind,
  EventActivity,
  EventActivityWithEvent,
} from '../types/host.types';

interface ActivityRow {
  id: string;
  event_id: string;
  invitation_id: string | null;
  kind: ActivityKind;
  guest_name: string | null;
  metadata: Record<string, unknown>;
  at: Date;
}

interface ActivityWithEventRow extends ActivityRow {
  event_title: string;
}

function toActivity(row: ActivityRow): EventActivity {
  return {
    id: row.id,
    eventId: row.event_id,
    invitationId: row.invitation_id,
    kind: row.kind,
    guestName: row.guest_name,
    metadata: row.metadata ?? {},
    at: row.at,
  };
}

function toActivityWithEvent(row: ActivityWithEventRow): EventActivityWithEvent {
  return { ...toActivity(row), eventTitle: row.event_title };
}

const SELECT_COLUMNS = `
  id, event_id, invitation_id, kind, guest_name, metadata, at
`;

export interface CreateActivityInput {
  eventId: string;
  invitationId?: string | null;
  kind: ActivityKind;
  guestName?: string | null;
  metadata?: Record<string, unknown>;
}

export const activityRepository = {
  async create(data: CreateActivityInput, client?: PoolClient): Promise<EventActivity> {
    const runner = client ?? pool;
    const result = await runner.query<ActivityRow>(
      `INSERT INTO event_activity (
         event_id, invitation_id, kind, guest_name, metadata
       )
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.eventId,
        data.invitationId ?? null,
        data.kind,
        data.guestName ?? null,
        JSON.stringify(data.metadata ?? {}),
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao registar actividade.');
    return toActivity(row);
  },

  async listForHost(
    hostId: string,
    offset: number,
    limit: number
  ): Promise<{ items: EventActivityWithEvent[]; total: number }> {
    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM event_activity a
         JOIN events e ON e.id = a.event_id
        WHERE e.host_id = $1`,
      [hostId]
    );

    const result = await query<ActivityWithEventRow>(
      `SELECT ${SELECT_COLUMNS.split(',').map((column) => `a.${column.trim()}`).join(', ')},
              e.title AS event_title
         FROM event_activity a
         JOIN events e ON e.id = a.event_id
        WHERE e.host_id = $1
        ORDER BY a.at DESC, a.id DESC
        LIMIT $2 OFFSET $3`,
      [hostId, limit, offset]
    );

    return {
      items: result.rows.map(toActivityWithEvent),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async listForEvent(
    eventId: string,
    offset: number,
    limit: number
  ): Promise<{ items: EventActivity[]; total: number }> {
    const countResult = await query<{ total: string }>(
      'SELECT count(*)::text AS total FROM event_activity WHERE event_id = $1',
      [eventId]
    );

    const result = await query<ActivityRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM event_activity
        WHERE event_id = $1
        ORDER BY at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [eventId, limit, offset]
    );

    return {
      items: result.rows.map(toActivity),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },
};
