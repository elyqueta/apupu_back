import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { HostReportSummary, reportRepository } from '../repositories/report.repository';
import { EventAccessScope, EventReportRow } from '../types/event.types';

export type ReportExportFormat = 'csv' | 'pdf';

export interface ReportExport {
  filename: string;
  contentType: string;
  body: Buffer;
}

const BRAND = '#0F3D3E';
const BRAND_SOFT = '#E7F0EC';
const ACCENT = '#FFB627';
const MINT = '#2F9E6E';
const CORAL = '#D95D4F';
const AMBER = '#C58A18';
const INK = '#1F2A2A';
const MUTED = '#647474';
const LINE = '#DCE5E2';
const CANVAS = '#F6F9F7';

const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

let logoCache: Buffer | null = null;

/**
 * Logo oficial usada no documento exportado.
 *
 * O PNG é copiado de `src/assets` para `dist/assets` no build. A fonte
 * original é o SVG público do frontend (`conta-comigo-logo.svg`).
 */
function logo(): Buffer {
  if (!logoCache) {
    logoCache = readFileSync(path.join(__dirname, '..', 'assets', 'conta-comigo-logo.png'));
  }
  return logoCache;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function responseRate(event: EventReportRow): number {
  if (event.totalInvitations === 0) return 0;
  return (event.accepted + event.declined) / event.totalInvitations;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Rascunho',
    scheduled: 'Agendado',
    cancelled: 'Cancelado',
    completed: 'Concluído',
  };
  return labels[status] ?? status;
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function safeCsvText(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function summaryCsv(summary: HostReportSummary, generatedAt: Date): Buffer {
  const lines: string[] = [
    csvCell('Conto Contigo — Relatório de eventos'),
    `${csvCell('Gerado em')},${csvCell(formatDate(generatedAt))}`,
    '',
    [
      'Evento',
      'Estado',
      'Convites',
      'Confirmados',
      'Recusados',
      'Pendentes',
      'Taxa de resposta (%)',
    ]
      .map(csvCell)
      .join(','),
  ];

  for (const event of summary.events) {
    lines.push(
      [
        csvCell(safeCsvText(event.title)),
        csvCell(statusLabel(event.status)),
        event.totalInvitations,
        event.accepted,
        event.declined,
        event.pending,
        Math.round(responseRate(event) * 100),
      ].join(',')
    );
  }

  lines.push(
    [
      csvCell('Total'),
      csvCell(''),
      summary.totals.total_invitations,
      summary.totals.accepted,
      summary.totals.declined,
      summary.totals.pending,
      Math.round(summary.totals.response_rate * 100),
    ].join(',')
  );

  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

function drawWatermark(doc: PDFKit.PDFDocument): void {
  doc.save();
  doc.opacity(0.05);
  const width = 380;
  const image = logo();
  const height = (width / 1200) * 351;
  doc.image(image, (doc.page.width - width) / 2, (doc.page.height - height) / 2, { width });
  doc.restore();
}

function drawHeader(doc: PDFKit.PDFDocument, generatedAt: Date): void {
  const image = logo();
  doc.image(image, PAGE_MARGIN, PAGE_MARGIN - 6, { width: 108 });

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(MUTED)
    .text('RELATÓRIO DE EVENTOS', PAGE_MARGIN, PAGE_MARGIN + 4, {
      width: CONTENT_WIDTH,
      align: 'right',
      characterSpacing: 1.2,
    });

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Gerado em ${formatDate(generatedAt)}`, PAGE_MARGIN, PAGE_MARGIN + 18, {
      width: CONTENT_WIDTH,
      align: 'right',
    });

  doc
    .moveTo(PAGE_MARGIN, PAGE_MARGIN + 42)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, PAGE_MARGIN + 42)
    .lineWidth(1)
    .strokeColor(LINE)
    .stroke();
}

function drawTitle(doc: PDFKit.PDFDocument): void {
  const y = PAGE_MARGIN + 62;

  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor(BRAND)
    .text('Resumo de respostas', PAGE_MARGIN, y, { width: CONTENT_WIDTH });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(
      'Visão agregada dos convites, confirmações e recusas de todos os eventos da conta.',
      PAGE_MARGIN,
      y + 32,
      { width: CONTENT_WIDTH }
    );
}

function drawMetric(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  color: string
): void {
  doc.roundedRect(x, y, width, 58, 9).fillColor(CANVAS).fill();
  doc.roundedRect(x, y, 4, 58, 2).fillColor(color).fill();

  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(INK)
    .text(value, x + 12, y + 10, { width: width - 20 });

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(label.toUpperCase(), x + 12, y + 34, {
      width: width - 20,
      characterSpacing: 0.6,
    });
}

function drawMetrics(doc: PDFKit.PDFDocument, summary: HostReportSummary): void {
  const y = PAGE_MARGIN + 118;
  const gap = 8;
  const width = (CONTENT_WIDTH - gap * 4) / 5;
  const metrics = [
    { label: 'Convites', value: String(summary.totals.total_invitations), color: BRAND },
    { label: 'Confirmados', value: String(summary.totals.accepted), color: MINT },
    { label: 'Pendentes', value: String(summary.totals.pending), color: AMBER },
    { label: 'Recusados', value: String(summary.totals.declined), color: CORAL },
    { label: 'Resposta', value: percent(summary.totals.response_rate), color: ACCENT },
  ];

  metrics.forEach((metric, index) => {
    drawMetric(
      doc,
      PAGE_MARGIN + index * (width + gap),
      y,
      width,
      metric.label,
      metric.value,
      metric.color
    );
  });
}

const COLUMNS = [
  { label: 'Evento', width: 196, align: 'left' as const },
  { label: 'Estado', width: 62, align: 'left' as const },
  { label: 'Convites', width: 48, align: 'right' as const },
  { label: 'Conf.', width: 44, align: 'right' as const },
  { label: 'Pend.', width: 44, align: 'right' as const },
  { label: 'Rec.', width: 44, align: 'right' as const },
  { label: 'Taxa', width: 61, align: 'right' as const },
];

function tableHeader(doc: PDFKit.PDFDocument, y: number): number {
  const height = 24;
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, height).fillColor(BRAND_SOFT).fill();

  let x = PAGE_MARGIN + 8;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND);
  for (const column of COLUMNS) {
    doc.text(column.label.toUpperCase(), x, y + 8, {
      width: column.width - 8,
      align: column.align,
      characterSpacing: 0.4,
      lineBreak: false,
    });
    x += column.width;
  }

  return y + height;
}

function drawTable(doc: PDFKit.PDFDocument, summary: HostReportSummary): void {
  let y = PAGE_MARGIN + 194;
  y = tableHeader(doc, y);

  if (summary.events.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text('Ainda não existem eventos para apresentar.', PAGE_MARGIN + 8, y + 14);
    return;
  }

  const rowHeight = 24;

  summary.events.forEach((event, index) => {
    if (y + rowHeight > doc.page.height - 72) {
      doc.addPage();
      drawWatermark(doc);
      y = PAGE_MARGIN;
      y = tableHeader(doc, y);
    }

    if (index % 2 === 1) {
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight).fillColor('#FBFDFC').fill();
    }

    const values = [
      truncate(event.title, 42),
      statusLabel(event.status),
      String(event.totalInvitations),
      String(event.accepted),
      String(event.pending),
      String(event.declined),
      percent(responseRate(event)),
    ];

    let x = PAGE_MARGIN + 8;
    doc.font('Helvetica').fontSize(8).fillColor(INK);
    values.forEach((value, columnIndex) => {
      const column = COLUMNS[columnIndex];
      if (!column) return;

      doc.fillColor(columnIndex === 6 ? BRAND : INK);
      doc.text(value, x, y + 8, {
        width: column.width - 8,
        align: column.align,
        lineBreak: false,
        ellipsis: true,
      });
      x += column.width;
    });

    doc
      .moveTo(PAGE_MARGIN, y + rowHeight)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();

    y += rowHeight;
  });
}

function drawFooters(doc: PDFKit.PDFDocument, generatedAt: Date): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const y = doc.page.height - 42;

    doc
      .moveTo(PAGE_MARGIN, y - 8)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y - 8)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(`Conto Contigo · ${formatDate(generatedAt)}`, PAGE_MARGIN, y, {
        width: CONTENT_WIDTH / 2,
        lineBreak: false,
      });

    doc.text(`Página ${index + 1} de ${range.count}`, PAGE_MARGIN + CONTENT_WIDTH / 2, y, {
      width: CONTENT_WIDTH / 2,
      align: 'right',
      lineBreak: false,
    });
  }
}

function summaryPdf(summary: HostReportSummary, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: 'Conto Contigo — Relatório de eventos',
        Author: 'Conto Contigo',
        Subject: 'Resumo de respostas aos convites',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.on('pageAdded', () => drawWatermark(doc));

    drawWatermark(doc);
    drawHeader(doc, generatedAt);
    drawTitle(doc);
    drawMetrics(doc, summary);
    drawTable(doc, summary);
    drawFooters(doc, generatedAt);
    doc.end();
  });
}

/**
 * Gera o relatório agregado em CSV ou PDF.
 *
 * O PDF reutiliza a identidade visual do site (logo, cores e tipografia)
 * e aplica a marca de água da plataforma em todas as páginas.
 */
export const reportExportService = {
  async summary(scope: EventAccessScope, format: ReportExportFormat): Promise<ReportExport> {
    const summary = await reportRepository.summaryForHost(scope);
    const generatedAt = new Date();
    const date = generatedAt.toISOString().slice(0, 10);

    if (format === 'csv') {
      return {
        filename: `conto-contigo-relatorio-${date}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: summaryCsv(summary, generatedAt),
      };
    }

    return {
      filename: `conto-contigo-relatorio-${date}.pdf`,
      contentType: 'application/pdf',
      body: await summaryPdf(summary, generatedAt),
    };
  },
};
