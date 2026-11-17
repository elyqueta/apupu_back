import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  ActivityKind,
  HostNotification,
  NotificationKind,
} from '../types/host.types';

interface NotificationRow {
  id: string;
  host_id: string;
  event_id: string | null;
  event_title: string | null;
  activity_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

function toNotification(row: NotificationRow): HostNotification {
  return {
    id: row.id,
    hostId: row.host_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    activityId: row.activity_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    metadata: row.metadata ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `
  n.id, n.host_id, n.event_id, n.activity_id, n.kind, n.title, n.body,
  n.metadata, n.read_at, n.created_at, e.title AS event_title
`;

const FROM_NOTIFICATIONS = `
  FROM host_notifications n
  LEFT JOIN events e ON e.id = n.event_id
`;

export interface NotificationListFilters {
  hostId: string;
  status: 'all' | 'unread' | 'read';
  kind?: NotificationKind;
  eventId?: string;
  q?: string;
  offset: number;
  limit: number;
}

interface ActivityNotificationText {
  title: string;
  body: string | null;
}

function activityText(
  kind: ActivityKind,
  guestName: string | null
): ActivityNotificationText {
  const guest = guestName?.trim() || 'Um convidado';

  switch (kind) {
    case 'rsvp_accepted':
      return { title: 'RSVP confirmado', body: `${guest} confirmou presença.` };
    case 'rsvp_declined':
      return { title: 'RSVP recusado', body: `${guest} recusou o convite.` };
    case 'guest_added':
      return { title: 'Novo convidado', body: `${guest} foi adicionado ao evento.` };
    case 'reminder_sent':
      return { title: 'Lembrete enviado', body: `Lembrete enviado a ${guest}.` };
    case 'event_created':
      return { title: 'Evento criado', body: 'O evento foi criado com sucesso.' };
  }
}

export const notificationRepository = {
  /**
   * Cria uma notificação para o proprietário e para os gestores com
   * conta verificada. A chave única `(host_id, activity_id)` garante
   * idempotência mesmo que a mesma actividade seja reprocessada.
   */
  async createForActivity(
    data: {
      eventId: string;
      activityId: string;
      kind: ActivityKind;
      guestName: string | null;
      metadata?: Record<string, unknown>;
    },
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    const text = activityText(data.kind, data.guestName);

    await runner.query(
      `WITH recipients AS (
         SELECT e.host_id AS host_id
           FROM events e
          WHERE e.id = $1
            AND e.host_id IS NOT NULL
         UNION
         SELECT h.id
           FROM events e
           JOIN event_managers m
             ON m.event_id = e.id
            AND m.revoked_at IS NULL
           JOIN hosts h
             ON h.email = m.email
            AND h.email_verified_at IS NOT NULL
            AND h.status = 'active'
          WHERE e.id = $1
       )
       INSERT INTO host_notifications (
         host_id, event_id, activity_id, kind, title, body, metadata
       )
       SELECT host_id, $1, $2, $3, $4, $5, $6::jsonb
         FROM recipients
       ON CONFLICT DO NOTHING`,
      [
        data.eventId,
        data.activityId,
        data.kind,
        text.title,
        text.body,
        JSON.stringify(data.metadata ?? {}),
      ]
    );
  },

  async createForHost(
    data: {
      hostId: string;
      eventId: string | null;
      kind: NotificationKind;
      title: string;
      body: string | null;
      metadata?: Record<string, unknown>;
      dedupeKey?: string | null;
    },
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;

    await runner.query(
      `INSERT INTO host_notifications (
         host_id, event_id, kind, title, body, metadata, dedupe_key
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT DO NOTHING`,
      [
        data.hostId,
        data.eventId,
        data.kind,
        data.title,
        data.body,
        JSON.stringify(data.metadata ?? {}),
        data.dedupeKey ?? null,
      ]
    );
  },

  /** Notifica a conta do gestor, se o email já tiver conta verificada. */
  async createForManager(
    managerId: string,
    data: {
      eventId: string;
      kind: NotificationKind;
      title: string;
      body: string | null;
      metadata?: Record<string, unknown>;
    },
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;

    await runner.query(
      `INSERT INTO host_notifications (
         host_id, event_id, kind, title, body, metadata
       )
       SELECT h.id, $2, $3, $4, $5, $6::jsonb
         FROM event_managers m
         JOIN hosts h
           ON h.email = m.email
          AND h.email_verified_at IS NOT NULL
          AND h.status = 'active'
        WHERE m.id = $1
          AND m.revoked_at IS NULL
       ON CONFLICT DO NOTHING`,
      [
        managerId,
        data.eventId,
        data.kind,
        data.title,
        data.body,
        JSON.stringify(data.metadata ?? {}),
      ]
    );
  },

  /**
   * Gera lembretes de eventos a aproximar-se e prazos de RSVP.
   *
   * É chamado antes de listar; `dedupe_key` impede duplicados entre
   * pedidos. Só são criados para eventos acessíveis à conta.
   */
  async syncReminders(
    scope: { hostId: string; managerEmail: string | null },
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
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

    await runner.query(
      `INSERT INTO host_notifications (
         host_id, event_id, kind, title, body, metadata, dedupe_key
       )
       SELECT $1, e.id, 'event_upcoming', 'Evento a aproximar-se',
              e.title || ' está a chegar.',
              jsonb_build_object('starts_at', e.starts_at),
              'event_upcoming:' || e.id || ':' || to_char(e.starts_at, 'YYYY-MM-DD')
         FROM events e
        WHERE ${access}
          AND e.status = 'scheduled'
          AND e.starts_at > now()
          AND e.starts_at <= now() + interval '7 days'
       ON CONFLICT DO NOTHING`,
      values
    );

    await runner.query(
      `INSERT INTO host_notifications (
         host_id, event_id, kind, title, body, metadata, dedupe_key
       )
       SELECT $1, e.id, 'rsvp_deadline', 'Prazo de resposta a terminar',
              e.title || ': o prazo de resposta termina em breve.',
              jsonb_build_object('rsvp_deadline', e.rsvp_deadline),
              'rsvp_deadline:' || e.id || ':' || to_char(e.rsvp_deadline, 'YYYY-MM-DD')
         FROM events e
        WHERE ${access}
          AND e.status = 'scheduled'
          AND e.rsvp_deadline IS NOT NULL
          AND e.rsvp_deadline > now()
          AND e.rsvp_deadline <= now() + interval '3 days'
       ON CONFLICT DO NOTHING`,
      values
    );
  },

  async listForHost(
    filters: NotificationListFilters
  ): Promise<{ items: HostNotification[]; total: number; unread: number }> {
    const values: unknown[] = [filters.hostId];
    const conditions = ['n.host_id = $1', 'n.dismissed_at IS NULL'];

    if (filters.status === 'unread') {
      conditions.push('n.read_at IS NULL');
    } else if (filters.status === 'read') {
      conditions.push('n.read_at IS NOT NULL');
    }

    if (filters.kind) {
      values.push(filters.kind);
      conditions.push(`n.kind = $${values.length}`);
    }

    if (filters.eventId) {
      values.push(filters.eventId);
      conditions.push(`n.event_id = $${values.length}`);
    }

    if (filters.q) {
      values.push(`%${filters.q}%`);
      conditions.push(
        `(n.title ILIKE $${values.length} OR n.body ILIKE $${values.length} OR e.title ILIKE $${values.length})`
      );
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ total: string; unread: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE n.read_at IS NULL)::text AS unread
         FROM host_notifications n
         LEFT JOIN events e ON e.id = n.event_id
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<NotificationRow>(
      `SELECT ${SELECT_COLUMNS}
       ${FROM_NOTIFICATIONS}
        WHERE ${where}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toNotification),
      total: Number(countResult.rows[0]?.total ?? '0'),
      unread: Number(countResult.rows[0]?.unread ?? '0'),
    };
  },

  async unreadCount(hostId: string): Promise<number> {
    const result = await query<{ unread: string }>(
      `SELECT count(*)::text AS unread
         FROM host_notifications
        WHERE host_id = $1
          AND read_at IS NULL
          AND dismissed_at IS NULL`,
      [hostId]
    );
    return Number(result.rows[0]?.unread ?? '0');
  },

  async setRead(
    id: string,
    hostId: string,
    read: boolean
  ): Promise<HostNotification | null> {
    const result = await query<NotificationRow>(
      `WITH updated AS (
         UPDATE host_notifications
            SET read_at = CASE WHEN $3 THEN now() ELSE NULL END
          WHERE id = $1
            AND host_id = $2
            AND dismissed_at IS NULL
          RETURNING *
       )
       SELECT ${SELECT_COLUMNS}
         FROM updated n
         LEFT JOIN events e ON e.id = n.event_id`,
      [id, hostId, read]
    );

    const row = result.rows[0];
    return row ? toNotification(row) : null;
  },

  async markAllRead(hostId: string): Promise<number> {
    const result = await query(
      `UPDATE host_notifications
          SET read_at = now()
        WHERE host_id = $1
          AND read_at IS NULL
          AND dismissed_at IS NULL`,
      [hostId]
    );
    return result.rowCount ?? 0;
  },

  async dismiss(id: string, hostId: string): Promise<boolean> {
    const result = await query(
      `UPDATE host_notifications
          SET dismissed_at = now()
        WHERE id = $1
          AND host_id = $2
          AND dismissed_at IS NULL`,
      [id, hostId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async dismissAll(hostId: string): Promise<number> {
    const result = await query(
      `UPDATE host_notifications
          SET dismissed_at = now()
        WHERE host_id = $1
          AND dismissed_at IS NULL`,
      [hostId]
    );
    return result.rowCount ?? 0;
  },
};
