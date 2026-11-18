import { HostReportSummary } from '../../repositories/report.repository';
import {
  formatReportCount,
  formatReportPercent,
  reportDocumentCode,
} from '../../utils/exportFormat.util';
import {
  drawDonut,
  drawHighlightBlock,
  drawSectionTitle,
  drawTitle,
  PdfContext,
  renderPdf,
} from './pdfLayout';
import { PDF_COLORS } from './pdfTheme';
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
