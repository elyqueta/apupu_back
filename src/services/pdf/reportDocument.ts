import { HostReportSummary } from '../../repositories/report.repository';
import { EventPeriodReport, EventRecord, EventReportRow } from '../../types/event.types';
import {
  formatCalendarDate,
  formatDisplayDateTime,
  formatReportCount,
  formatReportPercent,
  reportDocumentCode,
} from '../../utils/exportFormat.util';
import {
  drawDonut,
  drawHighlightBlock,
  drawSectionTitle,
  drawTable,
  drawTitle,
  PdfContext,
  renderPdf,
  TableCell,
  TableColumn,
} from './pdfLayout';
import { PDF_COLORS, mm } from './pdfTheme';
import { drawReportTable } from './reportTable';

export interface ReportPdfOptions {
  /**
   * Semente do código do documento. O serviço passa a conta; os testes
   * podem fixar um valor para obter um código determinístico.
   */
  documentSeed?: string;
}

/**
 * PDF do relatório agregado de eventos.
 *
 * O layout aprovado (cabeçalho, rodapé, título, donut e cores) é
 * mantido; a tabela usa o módulo dedicado `reportTable`.
 */
export function renderReportPdf(
  summary: HostReportSummary,
  generatedAt: Date,
  options: ReportPdfOptions = {}
): Promise<Buffer> {
  const meta = {
    documentType: 'Relatório de eventos',
    documentCode: reportDocumentCode(
      `${options.documentSeed ?? 'relatorio'}:${generatedAt.toISOString()}`,
      generatedAt
    ),
    generatedAt,
    title: 'Conto Contigo — Relatório de eventos',
    subject: 'Resumo de respostas aos convites de todos os eventos da conta',
  };

  return renderPdf(meta, (ctx: PdfContext) => {
    const y = drawTitle(ctx, 'Relatório de eventos', [
      'Visão agregada dos convites, confirmações e recusas de todos os eventos da conta.',
    ]);

    const afterHighlight = drawHighlightBlock(
      ctx,
      y,
      [
        { label: 'Convites', value: formatReportCount(summary.totals.total_invitations) },
        { label: 'Confirmados', value: formatReportCount(summary.totals.accepted) },
        { label: 'Pendentes', value: formatReportCount(summary.totals.pending) },
        { label: 'Recusados', value: formatReportCount(summary.totals.declined) },
        {
          label: 'Taxa de resposta',
          value: formatReportPercent(summary.totals.response_rate),
        },
      ],
      { background: PDF_COLORS.accent, backgroundOpacity: 0.14 }
    );

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
    drawReportTable(ctx, tableY, summary.events);
  });
}

function eventLocationLabel(event: EventRecord): string {
  if (event.location.type === 'online') {
    return 'Online';
  }

  const parts = [event.location.name, event.location.address].filter(
    (part): part is string => Boolean(part && part.trim())
  );
  return parts.length > 0 ? parts.join(' · ') : 'Local a confirmar';
}

function dailyColumns(): TableColumn[] {
  return [
    { label: 'Dia', weight: 1.4 },
    { label: 'Convites', weight: 0.9, align: 'right' },
    { label: 'Confirmados', weight: 1, align: 'right' },
    { label: 'Recusados', weight: 1, align: 'right' },
    { label: 'Lembretes', weight: 1, align: 'right' },
  ];
}

function dailyRows(report: EventPeriodReport): TableCell[][] {
  return report.daily.map((day) => [
    formatCalendarDate(day.date),
    String(day.invitations),
    String(day.accepted),
    String(day.declined),
    String(day.reminders),
  ]);
}

function currentEventRow(report: EventPeriodReport): EventReportRow {
  return {
    eventId: report.event.id,
    title: report.event.title,
    status: report.event.status,
    startsAt: report.event.startsAt,
    totalInvitations: report.current.totalInvitations,
    accepted: report.current.accepted,
    declined: report.current.declined,
    pending: report.current.pending,
  };
}

/**
 * PDF do relatório de um único evento num período.
 *
 * Reutiliza o cabeçalho, a marca de água, o bloco de destaque, o donut
 * e a tabela do relatório agregado. A tabela dedicada `drawReportTable`
 * fecha o documento com o estado atual do projeto.
 */
export function renderEventPeriodPdf(
  report: EventPeriodReport,
  generatedAt: Date,
  options: ReportPdfOptions = {}
): Promise<Buffer> {
  const { event, period, activity } = report;
  const meta = {
    documentType: 'Relatório do projeto',
    documentCode: reportDocumentCode(
      `${options.documentSeed ?? event.id}:${period.from}:${period.to}:${generatedAt.toISOString()}`,
      generatedAt
    ),
    generatedAt,
    title: `Conto Contigo — Relatório de ${event.title}`,
    subject: `Atividade do projeto entre ${period.from} e ${period.to}`,
  };

  return renderPdf(meta, (ctx: PdfContext) => {
    const y = drawTitle(ctx, 'Relatório do projeto', [
      event.title,
      `${formatDisplayDateTime(event.startsAt)} · ${eventLocationLabel(event)}`,
      `Período: ${formatCalendarDate(period.from)} a ${formatCalendarDate(period.to)} (dias UTC)`,
    ]);

    const afterHighlight = drawHighlightBlock(
      ctx,
      y,
      [
        { label: 'Convites criados', value: formatReportCount(activity.invitationsCreated) },
        { label: 'Confirmados', value: formatReportCount(activity.accepted) },
        { label: 'Recusados', value: formatReportCount(activity.declined) },
        { label: 'Pendentes criados', value: formatReportCount(activity.pendingCreated) },
        { label: 'Lembretes enviados', value: formatReportCount(activity.remindersSent) },
      ],
      { background: PDF_COLORS.accent, backgroundOpacity: 0.14 }
    );

    const afterDonut = drawDonut(
      ctx,
      afterHighlight,
      [
        {
          key: 'confirmed',
          label: 'Confirmado',
          value: activity.accepted,
          color: PDF_COLORS.confirmedText,
        },
        {
          key: 'declined',
          label: 'Recusado',
          value: activity.declined,
          color: PDF_COLORS.declinedText,
        },
      ],
      { centerLabel: 'RESPOSTAS' }
    );

    const dailyY = drawSectionTitle(ctx, afterDonut, 'Movimento diário');
    const afterDaily = drawTable(ctx, dailyY, dailyColumns(), dailyRows(report), {
      emptyMessage: 'Sem movimento no período.',
      fontSize: 8,
    });

    const currentY = drawSectionTitle(ctx, afterDaily + mm(4), 'Estado atual do projeto');
    drawReportTable(ctx, currentY, [currentEventRow(report)]);
  });
}
