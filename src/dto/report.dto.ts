import { DailyReportRow, EventReportRow } from '../types/event.types';

export interface EventReportDto {
  event_id: string;
  title: string;
  status: string;
  total_invitations: number;
  accepted: number;
  declined: number;
  pending: number;
}

export interface ReportSummaryDto {
  events: EventReportDto[];
  totals: {
    total_invitations: number;
    accepted: number;
    declined: number;
    pending: number;
    response_rate: number;
    acceptance_rate: number;
  };
}

export interface DailyReportDto {
  date: string;
  invitations: number;
  accepted: number;
  declined: number;
  reminders: number;
}

function toEventReportDto(row: EventReportRow): EventReportDto {
  return {
    event_id: row.eventId,
    title: row.title,
    status: row.status,
    total_invitations: row.totalInvitations,
    accepted: row.accepted,
    declined: row.declined,
    pending: row.pending,
  };
}

export function toReportSummaryDto(summary: {
  events: EventReportRow[];
  totals: ReportSummaryDto['totals'];
}): ReportSummaryDto {
  return {
    events: summary.events.map(toEventReportDto),
    totals: summary.totals,
  };
}

export function toDailyReportDto(row: DailyReportRow): DailyReportDto {
  return {
    date: row.date,
    invitations: row.invitations,
    accepted: row.accepted,
    declined: row.declined,
    reminders: row.reminders,
  };
}
