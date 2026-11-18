import QRCode from 'qrcode';
import SVGtoPDF from 'svg-to-pdfkit';
import PDFDocument from 'pdfkit';
import { publicAppBaseUrl } from '../../utils/links.util';
import { formatDisplayDateTime } from '../../utils/exportFormat.util';
import {
  logoHorizontalSvg,
  mm,
  PDF_COLORS,
  PDF_FONTS,
  PDF_PAGE,
  registerFonts,
  watermarkSvg,
} from './pdfTheme';

export type StatusTone = 'confirmed' | 'pending' | 'declined';

export interface PdfMeta {
  documentType: string;
  documentCode: string;
  generatedAt: Date;
  title: string;
  subject: string;
}

export interface PdfContext {
  doc: PDFKit.PDFDocument;
  meta: PdfMeta;
  left: number;
  width: number;
  pageWidth: number;
  pageHeight: number;
  contentTop: number;
  contentBottom: number;
}

export interface HighlightItem {
  label: string;
  value: string;
}

export interface HighlightBlockOptions {
  /** Cor de fundo (por omissão, o amarelo claro dos documentos). */
  background?: string;
  /** Opacidade do fundo, para deixar a marca de água visível. */
  backgroundOpacity?: number;
}

export interface DonutDatum {
  key: StatusTone;
  label: string;
  value: number;
  color: string;
}

export interface TableColumn {
  label: string;
  weight: number;
  align?: 'left' | 'right';
}

export type TableCell =
  | string
  | { text: string; tone?: StatusTone; align?: 'left' | 'right' };

const STATUS_TONES: Record<StatusTone, { text: string; background: string }> = {
  confirmed: { text: PDF_COLORS.confirmedText, background: PDF_COLORS.confirmedBg },
  pending: { text: PDF_COLORS.pendingText, background: PDF_COLORS.pendingBg },
  declined: { text: PDF_COLORS.declinedText, background: PDF_COLORS.declinedBg },
};

function siteUrl(): string {
  return publicAppBaseUrl().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function drawWatermark(ctx: PdfContext): void {
  const width = mm(100);
  const height = width * (240 / 168);
  const x = (ctx.pageWidth - width) / 2;
  const y = (ctx.pageHeight - height) / 2;

  // A opacidade de 6 % está dentro do SVG; ver `watermarkSvg()`.
  ctx.doc.save();
  SVGtoPDF(ctx.doc, watermarkSvg(0.06), x, y, {
    width,
    height,
    preserveAspectRatio: 'xMidYMid meet',
  });
  ctx.doc.restore();
}

function drawHeader(ctx: PdfContext): void {
  const { doc } = ctx;
  const top = PDF_PAGE.marginTop;

  SVGtoPDF(doc, logoHorizontalSvg(), ctx.left, top, {
    width: mm(38),
    preserveAspectRatio: 'xMinYMin meet',
  });

  doc
    .font(PDF_FONTS.bold)
    .fontSize(11)
    .fillColor(PDF_COLORS.brand)
    .text(ctx.meta.documentType, ctx.left, top + mm(0.5), {
      width: ctx.width,
      align: 'right',
      lineBreak: false,
    });

  doc
    .font(PDF_FONTS.regular)
    .fontSize(8.5)
    .fillColor(PDF_COLORS.muted)
    .text(`Gerado em ${formatDisplayDateTime(ctx.meta.generatedAt)}`, ctx.left, top + mm(6), {
      width: ctx.width,
      align: 'right',
      lineBreak: false,
    });

  doc
    .moveTo(ctx.left, top + mm(14))
    .lineTo(ctx.left + ctx.width, top + mm(14))
    .lineWidth(0.8)
    .strokeColor(PDF_COLORS.accent)
    .stroke();
}

function drawFooters(ctx: PdfContext): void {
  const { doc } = ctx;
  const range = doc.bufferedPageRange();
  const column = ctx.width / 3;

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);

    // O rodapé fica abaixo da margem inferior; sem isto o PDFKit
    // acrescentaria uma página por cada linha de texto do rodapé.
    const previousBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .moveTo(ctx.left, PDF_PAGE.footerLineY)
      .lineTo(ctx.left + ctx.width, PDF_PAGE.footerLineY)
      .lineWidth(0.5)
      .strokeColor(PDF_COLORS.line)
      .stroke();

    doc.font(PDF_FONTS.regular).fontSize(8).fillColor('#8A9694');
    doc.text('Conto Contigo · Luanda, Angola', ctx.left, PDF_PAGE.footerTextY, {
      width: column,
      lineBreak: false,
    });
    doc.text(siteUrl(), ctx.left, PDF_PAGE.footerTextY + mm(3.5), {
      width: column,
      lineBreak: false,
    });
    doc.text(`Página ${index + 1} de ${range.count}`, ctx.left + column, PDF_PAGE.footerTextY, {
      width: column,
      align: 'center',
      lineBreak: false,
    });
    doc.text(ctx.meta.documentCode, ctx.left + column * 2, PDF_PAGE.footerTextY, {
      width: column,
      align: 'right',
      lineBreak: false,
    });

    doc.page.margins.bottom = previousBottom;
  }
}

/**
 * Cria o documento A4 com a marca de água e o cabeçalho em todas as
 * páginas. A marca de água é desenhada primeiro, para ficar atrás do
 * conteúdo; o texto continua selecionável.
 */
export function renderPdf(
  meta: PdfMeta,
  draw: (ctx: PdfContext) => void | Promise<void>
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: {
      top: PDF_PAGE.marginTop,
      bottom: PDF_PAGE.marginBottom,
      left: PDF_PAGE.marginX,
      right: PDF_PAGE.marginX,
    },
    bufferPages: true,
    lang: 'pt-PT',
    info: {
      Title: meta.title,
      Author: 'Conto Contigo',
      Subject: meta.subject,
      Creator: 'Conto Contigo',
    },
  });

  registerFonts(doc);

  const ctx: PdfContext = {
    doc,
    meta,
    left: PDF_PAGE.marginX,
    width: PDF_PAGE.contentWidth,
    pageWidth: PDF_PAGE.width,
    pageHeight: PDF_PAGE.height,
    contentTop: PDF_PAGE.marginTop + PDF_PAGE.headerHeight,
    contentBottom: PDF_PAGE.contentBottom,
  };

  doc.on('pageAdded', () => {
    drawWatermark(ctx);
    drawHeader(ctx);
  });

  drawWatermark(ctx);
  drawHeader(ctx);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    Promise.resolve(draw(ctx))
      .then(() => {
        drawFooters(ctx);
        doc.end();
      })
      .catch(reject);
  });
}

/** Título e subtítulo da primeira página. Devolve o Y seguinte. */
export function drawTitle(ctx: PdfContext, title: string, subtitle: string[]): number {
  const { doc } = ctx;

  doc
    .font(PDF_FONTS.extraBold)
    .fontSize(20)
    .fillColor(PDF_COLORS.brand)
    .text(title, ctx.left, ctx.contentTop, { width: ctx.width });

  let y = doc.y + mm(2);
  doc.font(PDF_FONTS.regular).fontSize(11).fillColor(PDF_COLORS.muted);

  for (const line of subtitle) {
    doc.text(line, ctx.left, y, { width: ctx.width });
    y = doc.y + mm(0.5);
  }

  return y + mm(4);
}

/** Pequeno título de secção. */
export function drawSectionTitle(ctx: PdfContext, y: number, title: string): number {
  ctx.doc
    .font(PDF_FONTS.bold)
    .fontSize(11)
    .fillColor(PDF_COLORS.brand)
    .text(title, ctx.left, y, { width: ctx.width });
  return ctx.doc.y + mm(3);
}

/** Bloco de destaque com a barra dourada à esquerda. */
export function drawHighlightBlock(
  ctx: PdfContext,
  y: number,
  items: HighlightItem[],
  options: HighlightBlockOptions = {}
): number {
  const { doc } = ctx;
  const height = mm(22);

  // `fillOpacity` faz parte do graphics state: save/restore garante
  // que o texto seguinte continua totalmente opaco.
  doc.save();
  const background = doc
    .roundedRect(ctx.left, y, ctx.width, height, mm(1.5))
    .fillColor(options.background ?? PDF_COLORS.highlight);
  if (options.backgroundOpacity !== undefined) {
    background.fillOpacity(options.backgroundOpacity);
  }
  background.fill();
  doc.restore();

  doc.rect(ctx.left, y, mm(3), height).fillColor(PDF_COLORS.accent).fill();

  const innerLeft = ctx.left + mm(6);
  const innerWidth = ctx.width - mm(9);
  const itemWidth = innerWidth / Math.max(items.length, 1);

  items.forEach((item, index) => {
    const x = innerLeft + index * itemWidth;
    doc
      .font(PDF_FONTS.regular)
      .fontSize(8.5)
      .fillColor(PDF_COLORS.muted)
      .text(item.label, x, y + mm(4), { width: itemWidth - mm(3), lineBreak: false });
    doc
      .font(PDF_FONTS.extraBold)
      .fontSize(14)
      .fillColor(PDF_COLORS.brand)
      .text(item.value, x, y + mm(9), { width: itemWidth - mm(3), lineBreak: false });
  });

  return y + height + mm(6);
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number
): string {
  const from = polar(cx, cy, radius, start);
  const to = polar(cx, cy, radius, end);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${from.x.toFixed(3)} ${from.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArc} 1 ${to.x.toFixed(3)} ${to.y.toFixed(3)}`;
}

/**
 * Gráfico circular (donut) com legenda, equivalente ao da página de
 * relatórios. Desenhado com arcos vetoriais.
 */
export function drawDonut(ctx: PdfContext, y: number, data: DonutDatum[]): number {
  const { doc } = ctx;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = mm(15);
  const thickness = mm(5.5);
  const cx = ctx.left + mm(20);
  const cy = y + radius + thickness / 2;

  doc
    .circle(cx, cy, radius)
    .lineWidth(thickness)
    .strokeColor(PDF_COLORS.line)
    .stroke();

  const nonZero = data.filter((item) => item.value > 0).length;
  let angle = 0;

  for (const item of data) {
    const fraction = total > 0 ? item.value / total : 0;
    if (fraction <= 0) continue;

    if (fraction >= 0.9999) {
      doc.circle(cx, cy, radius).lineWidth(thickness).strokeColor(item.color).stroke();
      angle += 360;
      continue;
    }

    const gap = nonZero > 1 ? Math.min(2.5, (fraction * 360) / 4) : 0;
    const start = angle + gap / 2;
    const end = angle + fraction * 360 - gap / 2;

    if (end > start) {
      doc
        .path(arcPath(cx, cy, radius, start, end))
        .lineWidth(thickness)
        .strokeColor(item.color)
        .stroke();
    }

    angle += fraction * 360;
  }

  doc
    .font(PDF_FONTS.extraBold)
    .fontSize(20)
    .fillColor(PDF_COLORS.brand)
    .text(String(total), cx - radius, cy - mm(4), {
      width: radius * 2,
      align: 'center',
      lineBreak: false,
    });
  doc
    .font(PDF_FONTS.regular)
    .fontSize(7)
    .fillColor(PDF_COLORS.muted)
    .text('CONVIDADOS', cx - radius, cy + mm(2.5), {
      width: radius * 2,
      align: 'center',
      characterSpacing: 0.6,
      lineBreak: false,
    });

  // Legenda num bloco fixo de 210 pt, 24 pt à direita do donut e
  // centrado verticalmente com ele. Rótulo à esquerda, valor à direita
  // dentro do mesmo bloco.
  const legendWidth = 210;
  const legendGap = 24;
  const lineHeight = 20;
  const bulletSize = 8;
  const legendX = cx + radius + thickness / 2 + legendGap;
  const legendTop = cy - (data.length * lineHeight) / 2;

  doc.font(PDF_FONTS.regular).fontSize(9);
  const textLine = doc.currentLineHeight();

  data.forEach((item, index) => {
    const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;
    const rowY = legendTop + index * lineHeight;

    doc
      .circle(
        legendX + bulletSize / 2,
        rowY + lineHeight / 2,
        bulletSize / 2
      )
      .fillColor(item.color)
      .fill();

    doc
      .font(PDF_FONTS.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.ink)
      .text(item.label, legendX + 16, rowY + (lineHeight - textLine) / 2, {
        width: legendWidth - 16 - 90,
        lineBreak: false,
      });

    doc
      .font(PDF_FONTS.bold)
      .fontSize(9)
      .fillColor(PDF_COLORS.brand)
      .text(
        `${item.value} · ${percent} %`,
        legendX + legendWidth - 90,
        rowY + (lineHeight - textLine) / 2,
        { width: 90, align: 'right', lineBreak: false }
      );
  });

  const bottom = Math.max(cy + radius + thickness / 2, legendTop + data.length * lineHeight);
  return bottom + mm(6);
}

function drawBadge(ctx: PdfContext, x: number, y: number, label: string, tone: StatusTone): number {
  const { doc } = ctx;
  const style = STATUS_TONES[tone];
  const height = 14;

  doc.font(PDF_FONTS.bold).fontSize(8);
  const width = doc.widthOfString(label) + 12;

  doc.roundedRect(x, y, width, height, 4).fillColor(style.background).fill();
  doc
    .fillColor(style.text)
    .text(label, x + 6, y + 3, { width: width - 12, align: 'center', lineBreak: false });

  return width;
}

function columnWidths(contentWidth: number, columns: TableColumn[]): number[] {
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  return columns.map((column) => (contentWidth * column.weight) / totalWeight);
}

function rowHeight(
  ctx: PdfContext,
  row: TableCell[],
  widths: number[],
  fontSize: number
): number {
  let tallest = 0;

  row.forEach((cell, index) => {
    const width = widths[index] ?? 0;
    if (typeof cell === 'string') {
      ctx.doc.font(PDF_FONTS.regular).fontSize(fontSize);
      tallest = Math.max(tallest, ctx.doc.heightOfString(cell, { width: width - 16 }));
    } else if (cell.tone) {
      tallest = Math.max(tallest, 14);
    } else {
      ctx.doc.font(PDF_FONTS.regular).fontSize(fontSize);
      tallest = Math.max(tallest, ctx.doc.heightOfString(cell.text, { width: width - 16 }));
    }
  });

  return Math.max(mm(7), tallest + 12);
}

function drawTableHeader(
  ctx: PdfContext,
  y: number,
  columns: TableColumn[],
  widths: number[]
): number {
  const { doc } = ctx;
  const height = mm(8.5);

  doc.rect(ctx.left, y, ctx.width, height).fillColor(PDF_COLORS.brand).fill();

  let x = ctx.left;
  doc.font(PDF_FONTS.bold).fontSize(9).fillColor(PDF_COLORS.white);

  columns.forEach((column, index) => {
    const width = widths[index] ?? 0;
    doc.text(column.label, x + 8, y + (height - 9) / 2 - 1, {
      width: width - 16,
      align: column.align ?? 'left',
      lineBreak: false,
      ellipsis: true,
    });
    x += width;
  });

  return y + height;
}

function drawTableRow(
  ctx: PdfContext,
  y: number,
  row: TableCell[],
  columns: TableColumn[],
  widths: number[],
  index: number,
  fontSize: number,
  height: number
): void {
  const { doc } = ctx;

  if (index % 2 === 1) {
    doc.rect(ctx.left, y, ctx.width, height).fillColor(PDF_COLORS.stripe).fill();
  }

  let x = ctx.left;
  row.forEach((cell, columnIndex) => {
    const width = widths[columnIndex] ?? 0;
    const align = columns[columnIndex]?.align ?? 'left';

    if (typeof cell === 'string') {
      doc
        .font(PDF_FONTS.regular)
        .fontSize(fontSize)
        .fillColor(PDF_COLORS.ink)
        .text(cell, x + 8, y + 6, { width: width - 16, align, lineBreak: true });
    } else if (cell.tone) {
      drawBadge(ctx, x + 8, y + (height - 14) / 2, cell.text, cell.tone);
    } else {
      doc
        .font(PDF_FONTS.regular)
        .fontSize(fontSize)
        .fillColor(PDF_COLORS.ink)
        .text(cell.text, x + 8, y + 6, {
          width: width - 16,
          align: cell.align ?? align,
          lineBreak: true,
        });
    }

    x += width;
  });

  doc
    .moveTo(ctx.left, y + height)
    .lineTo(ctx.left + ctx.width, y + height)
    .lineWidth(0.5)
    .strokeColor(PDF_COLORS.line)
    .stroke();
}

function drawEmptyState(ctx: PdfContext, y: number, message: string): number {
  const height = mm(18);
  ctx.doc
    .roundedRect(ctx.left, y, ctx.width, height, mm(2))
    .fillColor(PDF_COLORS.stripe)
    .fill();
  ctx.doc
    .font(PDF_FONTS.regular)
    .fontSize(10)
    .fillColor(PDF_COLORS.muted)
    .text(message, ctx.left, y + mm(6), {
      width: ctx.width,
      align: 'center',
      lineBreak: false,
    });
  return y + height + mm(4);
}

/**
 * Tabela com cabeçalho repetido, linhas inteiras e estados vazios.
 * Devolve o Y depois da última linha.
 */
export function drawTable(
  ctx: PdfContext,
  y: number,
  columns: TableColumn[],
  rows: TableCell[][],
  options?: { emptyMessage?: string; fontSize?: number }
): number {
  const { doc } = ctx;
  const fontSize = options?.fontSize ?? 9;

  if (rows.length === 0) {
    return drawEmptyState(ctx, y, options?.emptyMessage ?? 'Ainda não há convidados');
  }

  const widths = columnWidths(ctx.width, columns);
  let cursor = drawTableHeader(ctx, y, columns, widths);

  rows.forEach((row, index) => {
    const height = rowHeight(ctx, row, widths, fontSize);

    if (cursor + height > ctx.contentBottom) {
      doc.addPage();
      cursor = ctx.contentTop;
      cursor = drawTableHeader(ctx, cursor, columns, widths);
    }

    drawTableRow(ctx, cursor, row, columns, widths, index, fontSize, height);
    cursor += height;
  });

  return cursor;
}

/**
 * QR de 32×32 mm com 4 mm de zona de silêncio. O conteúdo é gerado
 * como PNG de alta resolução; o resto do documento mantém-se vetorial.
 */
export async function drawQr(
  ctx: PdfContext,
  x: number,
  y: number,
  url: string,
  size = mm(32)
): Promise<void> {
  const quiet = mm(4);
  const qrSize = size - quiet * 2;
  const buffer = await QRCode.toBuffer(url, {
    type: 'png',
    margin: 0,
    width: 512,
    errorCorrectionLevel: 'M',
    color: { dark: PDF_COLORS.brand, light: PDF_COLORS.white },
  });

  ctx.doc.rect(x, y, size, size).fillColor(PDF_COLORS.white).fill();
  ctx.doc.image(buffer, x + quiet, y + quiet, { width: qrSize, height: qrSize });
}
