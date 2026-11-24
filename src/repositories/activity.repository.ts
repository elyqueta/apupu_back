import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  ActivityKind,
  EventActivity,
  EventActivityWithEvent,
} from '../types/host.types';
import { notificationRepository } from './notification.repository';

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

    const activity = toActivity(row);

    await notificationRepository.createForActivity(
      {
        eventId: activity.eventId,
        activityId: activity.id,
        kind: activity.kind,
        guestName: activity.guestName,
        metadata: activity.metadata,
      },
      client
    );

    return activity;
  },

  async listForHost(
    scope: { hostId: string; managerEmail: string | null },
    offset: number,
    limit: number
  ): Promise<{ items: EventActivityWithEvent[]; total: number }> {
    const values: unknown[] = [scope.hostId];
    let access = 'e.host_id = $1';

    if (scope.managerEmail) {
      values.push(scope.managerEmail);
      access = `(e.host_id = $1 OR EXISTS (
        SELECT 1
          FROM event_managers m
         WHERE m.event_id = e.id
           AND m.email = $2::citext
           AND m.revoked_at IS NULL
      ))`;
    }

    access = `${access} AND e.deleted_at IS NULL`;

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM event_activity a
         JOIN events e ON e.id = a.event_id
        WHERE ${access}`,
      values
    );

    const listValues = [...values, limit, offset];
    const result = await query<ActivityWithEventRow>(
      `SELECT ${SELECT_COLUMNS.split(',').map((column) => `a.${column.trim()}`).join(', ')},
              e.title AS event_title
         FROM event_activity a
         JOIN events e ON e.id = a.event_id
        WHERE ${access}
        ORDER BY a.at DESC, a.id DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
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

  /**
   * Remove uma actividade do histórico do evento.
   *
   * Só é chamado pela rota de gestão do evento. A notificação associada
   * é removida por `ON DELETE CASCADE`.
   */
  async deleteForEvent(eventId: string, activityId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM event_activity WHERE id = $1 AND event_id = $2',
      [activityId, eventId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
