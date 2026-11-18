import { Readable } from 'node:stream';
import { BadRequestError, NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { reportRepository } from '../repositories/report.repository';
import { EventAccessScope, EventRecord, EventStats } from '../types/event.types';
import { exportDateStamp, exportFilename } from '../utils/exportFormat.util';
import { csvExportService } from './csvExport.service';
import {
  renderAttendancePdf,
  renderEventSummaryPdf,
  renderGuestsPdf,
  renderTicketPdf,
} from './pdf/eventDocuments';
import { renderReportPdf } from './pdf/reportDocument';

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

    const body = await renderReportPdf(summary, generatedAt, {
      documentSeed: scope.hostId,
    });
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
