import { query } from '../database/pool';
import { DailyReportRow, EventReportRow } from '../types/event.types';

interface SummaryRow {
  event_id: string;
  title: string;
  status: EventReportRow['status'];
  total: string;
  accepted: string;
  declined: string;
  pending: string;
}

interface DailyRow {
  date: string;
  invitations: string;
  accepted: string;
  declined: string;
  reminders: string;
}

export interface HostReportSummary {
  events: EventReportRow[];
  totals: {
    total_invitations: number;
    accepted: number;
    declined: number;
    pending: number;
    response_rate: number;
    acceptance_rate: number;
  };
}

/**
 * Consultas de relatórios.
 *
 * `response_rate` e `acceptance_rate` são calculados no servidor para
 * que todos os clientes apresentem o mesmo número. Os relatórios são
 * sempre limitados por `events.host_id` no serviço, antes de chegar
 * aqui.
 */
export const reportRepository = {
  async summaryForHost(hostId: string): Promise<HostReportSummary> {
    const result = await query<SummaryRow>(
      `SELECT e.id AS event_id, e.title, e.status,
              count(i.id)::text AS total,
              count(i.id) FILTER (WHERE i.rsvp_status = 'accepted')::text AS accepted,
              count(i.id) FILTER (WHERE i.rsvp_status = 'declined')::text AS declined,
              count(i.id) FILTER (WHERE i.rsvp_status = 'pending')::text AS pending
         FROM events e
         LEFT JOIN invitations i ON i.event_id = e.id
        WHERE e.host_id = $1
        GROUP BY e.id
        ORDER BY e.starts_at DESC, e.id DESC`,
      [hostId]
    );

    const events: EventReportRow[] = result.rows.map((row) => ({
      eventId: row.event_id,
      title: row.title,
      status: row.status,
      totalInvitations: Number(row.total),
      accepted: Number(row.accepted),
      declined: Number(row.declined),
      pending: Number(row.pending),
    }));

    const totals = events.reduce(
      (acc, event) => ({
        total_invitations: acc.total_invitations + event.totalInvitations,
        accepted: acc.accepted + event.accepted,
        declined: acc.declined + event.declined,
        pending: acc.pending + event.pending,
      }),
      { total_invitations: 0, accepted: 0, declined: 0, pending: 0 }
    );

    const responded = totals.accepted + totals.declined;

    return {
      events,
      totals: {
        ...totals,
        response_rate:
          totals.total_invitations === 0
            ? 0
            : Number((responded / totals.total_invitations).toFixed(4)),
        acceptance_rate:
          totals.total_invitations === 0
            ? 0
            : Number((totals.accepted / totals.total_invitations).toFixed(4)),
      },
    };
  },

  /**
   * Série diária dos últimos `days` dias (UTC).
   *
   * A janela e a granularidade são fixas e documentadas no contrato:
   * um ponto por dia, incluindo dias sem movimento.
   */
  async dailyForEvent(eventId: string, days: number): Promise<DailyReportRow[]> {
    const result = await query<DailyRow>(
      `WITH window_days AS (
         SELECT generate_series(
           (date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => $2 - 1))::date,
           date_trunc('day', now() AT TIME ZONE 'UTC')::date,
           '1 day'
         )::date AS day
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
         (SELECT count(*) FROM invitations i
           WHERE i.event_id = $1
             AND i.created_at >= d.day::timestamp AT TIME ZONE 'UTC'
             AND i.created_at < (d.day + 1)::timestamp AT TIME ZONE 'UTC')::text AS invitations,
         (SELECT count(*) FROM invitations i
           WHERE i.event_id = $1
             AND i.rsvp_status = 'accepted'
             AND i.rsvp_responded_at >= d.day::timestamp AT TIME ZONE 'UTC'
             AND i.rsvp_responded_at < (d.day + 1)::timestamp AT TIME ZONE 'UTC')::text AS accepted,
         (SELECT count(*) FROM invitations i
           WHERE i.event_id = $1
             AND i.rsvp_status = 'declined'
             AND i.rsvp_responded_at >= d.day::timestamp AT TIME ZONE 'UTC'
             AND i.rsvp_responded_at < (d.day + 1)::timestamp AT TIME ZONE 'UTC')::text AS declined,
         (SELECT count(*) FROM email_deliveries ed
           WHERE ed.event_id = $1
             AND ed.message_type = 'reminder'
             AND ed.status = 'sent'
             AND ed.sent_at >= d.day::timestamp AT TIME ZONE 'UTC'
             AND ed.sent_at < (d.day + 1)::timestamp AT TIME ZONE 'UTC')::text AS reminders
       FROM window_days d
       ORDER BY d.day ASC`,
      [eventId, days]
    );

    return result.rows.map((row) => ({
      date: row.date,
      invitations: Number(row.invitations),
      accepted: Number(row.accepted),
      declined: Number(row.declined),
      reminders: Number(row.reminders),
    }));
  },
};
