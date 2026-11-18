import { Readable } from 'node:stream';
import { HostReportSummary } from '../repositories/report.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { EventPeriodReport, EventRecord, EventReportRow, EventStats } from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import {
  csvHeader,
  csvRow,
  eventStatusLabel,
  exportDateStamp,
  exportFilename,
  formatAngolaPhone,
  formatCalendarDate,
  formatExportDateTime,
  formatExportNumber,
  periodExportFilename,
  rsvpStatusLabel,
} from '../utils/exportFormat.util';

export interface CsvExport {
  filename: string;
  contentType: string;
  stream: Readable;
}

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
const PAGE_SIZE = 500;

const GUEST_HEADER = [
  'Nome',
  'Telemóvel',
  'E-mail',
  'Estado',
  'Mesa',
  'Respondeu em',
  'Enviado em',
  'Evento',
];

const ATTENDANCE_HEADER = [
  'Nome',
  'E-mail',
  'Telemóvel',
  'Mesa',
  'Respondeu em',
  'Evento',
];

const SUMMARY_HEADER = [
  'Evento',
  'Data',
  'Local',
  'Anfitrião',
  'Estado',
  'Convites',
  'Confirmados',
  'Pendentes',
  'Recusados',
  'Taxa de resposta (%)',
  'Taxa de confirmação (%)',
];

const REPORT_HEADER = [
  'Evento',
  'Estado',
  'Convites',
  'Confirmados',
  'Pendentes',
  'Recusados',
  'Taxa de resposta (%)',
];

const PERIOD_REPORT_HEADER = [
  'Evento',
  'Início do período',
  'Fim do período',
  'Convites criados',
  'Confirmados no período',
  'Recusados no período',
  'Pendentes criados',
  'Lembretes enviados',
  'Convites atuais',
  'Confirmados atuais',
  'Pendentes atuais',
  'Recusados atuais',
  'Taxa de resposta atual (%)',
  'Taxa de confirmação atual (%)',
];

/** Junta as linhas com BOM e CRLF, sem carregar o CSV inteiro em memória. */
function streamLines(lines: AsyncIterable<string> | Iterable<string>): Readable {
  return Readable.from(
    (async function* (): AsyncGenerator<Buffer> {
      yield Buffer.from('\uFEFF', 'utf8');
      for await (const line of lines) {
        yield Buffer.from(`${line}\r\n`, 'utf8');
      }
    })(),
    { objectMode: false }
  );
}

function responseRate(total: number, accepted: number, declined: number): string {
  if (total === 0) return formatExportNumber(0, 1);
  return formatExportNumber(((accepted + declined) / total) * 100, 1);
}

function acceptanceRate(total: number, accepted: number): string {
  if (total === 0) return formatExportNumber(0, 1);
  return formatExportNumber((accepted / total) * 100, 1);
}

function locationLabel(event: EventRecord): string {
  if (event.location.type === 'online') return 'Online';
  return [event.location.name, event.location.address]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');
}

function eventRow(event: EventRecord, stats: EventStats): string[] {
  return [
    event.title,
    formatExportDateTime(event.startsAt),
    locationLabel(event),
    event.hostName,
    eventStatusLabel(event.status),
    String(stats.totalInvitations),
    String(stats.accepted),
    String(stats.pending),
    String(stats.declined),
    responseRate(stats.totalInvitations, stats.accepted, stats.declined),
    acceptanceRate(stats.totalInvitations, stats.accepted),
  ];
}

function reportRow(event: EventReportRow): string[] {
  return [
    event.title,
    eventStatusLabel(event.status),
    String(event.totalInvitations),
    String(event.accepted),
    String(event.pending),
    String(event.declined),
    responseRate(event.totalInvitations, event.accepted, event.declined),
  ];
}

function periodReportRow(report: EventPeriodReport): string[] {
  const { activity, current, event, period } = report;

  return [
    event.title,
    formatCalendarDate(period.from),
    formatCalendarDate(period.to),
    String(activity.invitationsCreated),
    String(activity.accepted),
    String(activity.declined),
    String(activity.pendingCreated),
    String(activity.remindersSent),
    String(current.totalInvitations),
    String(current.accepted),
    String(current.pending),
    String(current.declined),
    responseRate(current.totalInvitations, current.accepted, current.declined),
    acceptanceRate(current.totalInvitations, current.accepted),
  ];
}

function guestRow(guest: Invitation, eventTitle: string): string[] {
  return [
    guest.guestName,
    formatAngolaPhone(guest.guestPhone),
    guest.guestEmail,
    rsvpStatusLabel(guest.rsvpStatus),
    guest.tableName ?? '',
    formatExportDateTime(guest.rsvpRespondedAt),
    formatExportDateTime(guest.lastSentAt),
    eventTitle,
  ];
}

function attendanceRow(guest: Invitation, eventTitle: string): string[] {
  return [
    guest.guestName,
    guest.guestEmail,
    formatAngolaPhone(guest.guestPhone),
    guest.tableName ?? '',
    formatExportDateTime(guest.rsvpRespondedAt),
    eventTitle,
  ];
}

/** Percorre os convidados do evento em páginas, sem os carregar todos. */
async function* guestPages(eventId: string): AsyncGenerator<Invitation[]> {
  let offset = 0;

  for (;;) {
    const page = await invitationRepository.listByEventSlice(eventId, offset, PAGE_SIZE);
    if (page.length === 0) return;

    yield page;

    if (page.length < PAGE_SIZE) return;
    offset += page.length;
  }
}

async function* guestLines(event: EventRecord): AsyncGenerator<string> {
  yield csvHeader(GUEST_HEADER);

  for await (const page of guestPages(event.id)) {
    for (const guest of page) {
      yield csvRow(guestRow(guest, event.title));
    }
  }
}

async function* attendanceLines(event: EventRecord): AsyncGenerator<string> {
  yield csvHeader(ATTENDANCE_HEADER);

  for await (const page of guestPages(event.id)) {
    for (const guest of page) {
      if (guest.rsvpStatus === 'accepted') {
        yield csvRow(attendanceRow(guest, event.title));
      }
    }
  }
}

function filenameFor(kind: string, event: EventRecord, generatedAt: Date): string {
  return exportFilename(kind, event.title, generatedAt, 'csv');
}

export const csvExportService = {
  /** Lista completa de convidados e respostas. */
  guests(event: EventRecord, generatedAt: Date): CsvExport {
    return {
      filename: filenameFor('convidados', event, generatedAt),
      contentType: CSV_CONTENT_TYPE,
      stream: streamLines(guestLines(event)),
    };
  },

  /** Presenças confirmadas (não existe check-in). */
  attendance(event: EventRecord, generatedAt: Date): CsvExport {
    return {
      filename: filenameFor('presencas', event, generatedAt),
      contentType: CSV_CONTENT_TYPE,
      stream: streamLines(attendanceLines(event)),
    };
  },

  /** Resumo do evento com os mesmos agregados do PDF. */
  eventSummary(event: EventRecord, stats: EventStats, generatedAt: Date): CsvExport {
    const lines = [csvHeader(SUMMARY_HEADER), csvRow(eventRow(event, stats))];

    return {
      filename: filenameFor('resumo', event, generatedAt),
      contentType: CSV_CONTENT_TYPE,
      stream: streamLines(lines),
    };
  },

  /** Relatório agregado de todos os eventos da conta. */
  report(summary: HostReportSummary, generatedAt: Date): CsvExport {
    const lines = [csvHeader(REPORT_HEADER), ...summary.events.map((event) => csvRow(reportRow(event)))];

    return {
      filename: `conto-contigo_relatorio_${exportDateStamp(generatedAt)}.csv`,
      contentType: CSV_CONTENT_TYPE,
      stream: streamLines(lines),
    };
  },

  /**
   * Relatório de um evento num período.
   *
   * Uma única linha resume o movimento do período e o estado atual do
   * evento. O detalhe diário fica no PDF, para não misturar duas
   * tabelas no mesmo CSV.
   */
  eventPeriodReport(report: EventPeriodReport): CsvExport {
    const lines = [csvHeader(PERIOD_REPORT_HEADER), csvRow(periodReportRow(report))];

    return {
      filename: periodExportFilename(
        'relatorio',
        report.event.title,
        report.period.from,
        report.period.to,
        'csv'
      ),
      contentType: CSV_CONTENT_TYPE,
      stream: streamLines(lines),
    };
  },
};

/** Exposto para testes de formatação sem gerar o ficheiro completo. */
export const csvInternals = {
  guestRow,
  attendanceRow,
  eventRow,
  reportRow,
  periodReportRow,
};
