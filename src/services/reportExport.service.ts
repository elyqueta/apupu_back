import { Readable } from 'node:stream';
import { BadRequestError, NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { HostReportSummary, reportRepository } from '../repositories/report.repository';
import { EventAccessScope, EventRecord, EventStats } from '../types/event.types';
import {
  documentCode,
  eventStatusLabel,
  exportDateStamp,
  exportFilename,
} from '../utils/exportFormat.util';
import { csvExportService } from './csvExport.service';
import {
  renderAttendancePdf,
  renderEventSummaryPdf,
  renderGuestsPdf,
  renderTicketPdf,
} from './pdf/eventDocuments';
import {
  drawDonut,
  drawHighlightBlock,
  drawSectionTitle,
  drawTable,
  drawTitle,
  renderPdf,
  TableCell,
  TableColumn,
} from './pdf/pdfLayout';
import { PDF_COLORS } from './pdf/pdfTheme';

export type ReportExportFormat = 'csv' | 'pdf';
export type EventExportDocument = 'guests' | 'summary' | 'attendance' | 'ticket';

export interface ReportExport {
  filename: string;
  contentType: string;
  stream: Readable;
}

export interface EventExportOptions {
  invitationId?: string;
}

function bufferStream(body: Buffer): Readable {
  return Readable.from([body], { objectMode: false });
}

function pdfExport(body: Buffer, filename: string): ReportExport {
  return {
    filename,
    contentType: 'application/pdf',
    stream: bufferStream(body),
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function reportColumns(): TableColumn[] {
  return [
    { label: 'Evento', weight: 3 },
    { label: 'Estado', weight: 1.3 },
    { label: 'Convites', weight: 1, align: 'right' },
    { label: 'Confirmados', weight: 1.2, align: 'right' },
    { label: 'Pendentes', weight: 1.1, align: 'right' },
    { label: 'Recusados', weight: 1.1, align: 'right' },
    { label: 'Taxa', weight: 1, align: 'right' },
  ];
}

function reportRows(summary: HostReportSummary): TableCell[][] {
  return summary.events.map((event) => {
    const rate =
      event.totalInvitations === 0
        ? 0
        : (event.accepted + event.declined) / event.totalInvitations;

    return [
      event.title,
      eventStatusLabel(event.status),
      String(event.totalInvitations),
      String(event.accepted),
      String(event.pending),
      String(event.declined),
      percent(rate),
    ];
  });
}

/** Relatório agregado com o mesmo gráfico circular da página de relatórios. */
function reportPdf(summary: HostReportSummary, generatedAt: Date): Promise<Buffer> {
  const meta = {
    documentType: 'Relatório de eventos',
    documentCode: documentCode('CC-REL', '00000000', generatedAt),
    generatedAt,
    title: 'Conto Contigo — Relatório de eventos',
    subject: 'Resumo de respostas aos convites de todos os eventos da conta',
  };

  return renderPdf(meta, (ctx) => {
    const y = drawTitle(ctx, 'Relatório de eventos', [
      'Visão agregada dos convites, confirmações e recusas de todos os eventos da conta.',
    ]);
    const afterHighlight = drawHighlightBlock(ctx, y, [
      { label: 'Convites', value: String(summary.totals.total_invitations) },
      { label: 'Confirmados', value: String(summary.totals.accepted) },
      { label: 'Pendentes', value: String(summary.totals.pending) },
      { label: 'Recusados', value: String(summary.totals.declined) },
      { label: 'Taxa de resposta', value: percent(summary.totals.response_rate) },
    ]);
    const afterDonut = drawDonut(ctx, afterHighlight, [
      {
        key: 'confirmed',
        label: 'Confirmado',
        value: summary.totals.accepted,
        color: PDF_COLORS.confirmedText,
      },
      {
        key: 'pending',
        label: 'Pendente',
        value: summary.totals.pending,
        color: PDF_COLORS.pendingText,
      },
      {
        key: 'declined',
        label: 'Recusado',
        value: summary.totals.declined,
        color: PDF_COLORS.declinedText,
      },
    ]);
    const tableY = drawSectionTitle(ctx, afterDonut, 'Respostas por evento');

    drawTable(ctx, tableY, reportColumns(), reportRows(summary), {
      emptyMessage: 'Ainda não existem eventos para apresentar.',
    });
  });
}

function eventPdfFilename(
  kind: string,
  event: EventRecord,
  generatedAt: Date
): string {
  return exportFilename(kind, event.title, generatedAt, 'pdf');
}

export const reportExportService = {
  /**
   * Relatório agregado de todos os eventos da conta.
   *
   * O CSV é emitido em streaming; o PDF usa o layout partilhado e
   * inclui o gráfico circular da página de relatórios.
   */
  async summary(
    scope: EventAccessScope,
    format: ReportExportFormat
  ): Promise<ReportExport> {
    const summary = await reportRepository.summaryForHost(scope);
    const generatedAt = new Date();

    if (format === 'csv') {
      return csvExportService.report(summary, generatedAt);
    }

    const body = await reportPdf(summary, generatedAt);
    return pdfExport(
      body,
      `conto-contigo_relatorio_${exportDateStamp(generatedAt)}.pdf`
    );
  },

  /**
   * Documento de um evento: lista de convidados, resumo, presenças ou
   * bilhete individual.
   *
   * O acesso é validado com `findByIdForAccess`, para que um UUID de
   * evento não seja autorização suficiente. O bilhete exige
   * `invitation_id` e só existe em PDF.
   */
  async eventDocument(
    scope: EventAccessScope,
    eventId: string,
    document: EventExportDocument,
    format: ReportExportFormat,
    options: EventExportOptions = {}
  ): Promise<ReportExport> {
    const access = await eventRepository.findByIdForAccess(eventId, scope);
    if (!access) {
      throw new NotFoundError('Evento não encontrado.');
    }

    const event = access.event;
    const generatedAt = new Date();

    if (document === 'ticket') {
      if (format !== 'pdf') {
        throw new BadRequestError('O bilhete só está disponível em PDF.');
      }
      if (!options.invitationId) {
        throw new BadRequestError(
          'Indica o convite do bilhete.',
          'bad_request',
          { invitation_id: ['Obrigatório para o bilhete.'] }
        );
      }

      const invitation = await invitationRepository.findById(options.invitationId);
      if (!invitation || invitation.eventId !== event.id) {
        throw new NotFoundError('Convite não encontrado.');
      }

      const body = await renderTicketPdf(event, invitation, generatedAt);
      return pdfExport(
        body,
        eventPdfFilename('bilhete', event, generatedAt)
      );
    }

    if (format === 'csv') {
      if (document === 'guests') {
        return csvExportService.guests(event, generatedAt);
      }
      if (document === 'attendance') {
        return csvExportService.attendance(event, generatedAt);
      }

      const stats = await invitationRepository.statsForEvent(event.id);
      return csvExportService.eventSummary(event, stats, generatedAt);
    }

    const stats: EventStats = await invitationRepository.statsForEvent(event.id);

    if (document === 'summary') {
      const body = await renderEventSummaryPdf(event, stats, generatedAt);
      return pdfExport(body, eventPdfFilename('resumo', event, generatedAt));
    }

    const guests = await invitationRepository.listByEvent(event.id);

    if (document === 'attendance') {
      const body = await renderAttendancePdf(event, guests, stats, generatedAt);
      return pdfExport(body, eventPdfFilename('presencas', event, generatedAt));
    }

    const body = await renderGuestsPdf(event, guests, stats, generatedAt);
    return pdfExport(body, eventPdfFilename('convidados', event, generatedAt));
  },
};
