import { logger } from '../../config/logger';
import { EventReportRow } from '../../types/event.types';
import {
  eventStatusLabel,
  formatReportCount,
  formatReportPercent,
  formatWeekdayDateTime,
  reportResponseRate,
  reportRowIsConsistent,
} from '../../utils/exportFormat.util';
import { PdfContext } from './pdfLayout';
import { PDF_COLORS, PDF_FONTS } from './pdfTheme';

type ReportColumnKey =
  | 'event'
  | 'status'
  | 'invitations'
  | 'accepted'
  | 'pending'
  | 'declined'
  | 'rate';

interface ReportColumn {
  key: ReportColumnKey;
  label: string;
  width: number;
  align: 'left' | 'center';
}

type ReportColumns = [
  ReportColumn,
  ReportColumn,
  ReportColumn,
  ReportColumn,
  ReportColumn,
  ReportColumn,
  ReportColumn,
];

const STATUS_COLUMN_WIDTH = 64;
const INVITATIONS_COLUMN_WIDTH = 52;
const ACCEPTED_COLUMN_WIDTH = 64;
const PENDING_COLUMN_WIDTH = 58;
const DECLINED_COLUMN_WIDTH = 58;
const RATE_COLUMN_WIDTH = 68;

const FIXED_COLUMNS_WIDTH =
  STATUS_COLUMN_WIDTH +
  INVITATIONS_COLUMN_WIDTH +
  ACCEPTED_COLUMN_WIDTH +
  PENDING_COLUMN_WIDTH +
  DECLINED_COLUMN_WIDTH +
  RATE_COLUMN_WIDTH;

const HEADER_HEIGHT = 26;
const HEADER_PADDING = 5;
const CELL_PADDING_X = 8;
const CELL_PADDING_Y = 9;
const MIN_ROW_HEIGHT = 34;
const TOTALS_HEIGHT = 30;

const RATE_BAR_WIDTH = 34;
const RATE_BAR_HEIGHT = 4;
const RATE_COLOR = '#2A7270';
const ZERO_COLOR = '#8A9694';

const STATUS_STYLES: Record<string, { text: string; background: string }> = {
  draft: { text: '#5B6B69', background: '#EEF0EF' },
  scheduled: { text: '#2A6F97', background: '#E5F0F7' },
  ongoing: { text: '#2E7D4F', background: '#E6F3EB' },
  completed: { text: '#5B6B69', background: '#EEF0EF' },
  cancelled: { text: '#B3382C', background: '#FBEAE8' },
};

const NUMBER_COLORS: Record<'accepted' | 'pending' | 'declined', string> = {
  accepted: PDF_COLORS.confirmedText,
  pending: PDF_COLORS.pendingText,
  declined: PDF_COLORS.declinedText,
};

function columnsFor(ctx: PdfContext): ReportColumns {
  return [
    {
      key: 'event',
      label: 'Evento',
      width: ctx.width - FIXED_COLUMNS_WIDTH,
      align: 'left',
    },
    { key: 'status', label: 'Estado', width: STATUS_COLUMN_WIDTH, align: 'center' },
    {
      key: 'invitations',
      label: 'Convites',
      width: INVITATIONS_COLUMN_WIDTH,
      align: 'center',
    },
    {
      key: 'accepted',
      label: 'Confirmados',
      width: ACCEPTED_COLUMN_WIDTH,
      align: 'center',
    },
    {
      key: 'pending',
      label: 'Pendentes',
      width: PENDING_COLUMN_WIDTH,
      align: 'center',
    },
    {
      key: 'declined',
      label: 'Recusados',
      width: DECLINED_COLUMN_WIDTH,
      align: 'center',
    },
    { key: 'rate', label: 'Taxa de resposta', width: RATE_COLUMN_WIDTH, align: 'left' },
  ];
}

const DEFAULT_STATUS_STYLE = { text: '#5B6B69', background: '#EEF0EF' };

function statusStyle(status: string): { text: string; background: string } {
  return STATUS_STYLES[status] ?? DEFAULT_STATUS_STYLE;
}

function statusLabel(status: string): string {
  return status === 'ongoing' ? 'Em curso' : eventStatusLabel(status);
}

/**
 * Cabeçalho de altura fixa (26 pt), numa só linha. Se as larguras
 * medidas ultrapassarem a coluna, reduz para 7 pt em vez de partir a
 * palavra.
 */
function headerFontSize(ctx: PdfContext, columns: ReportColumn[]): number {
  const fits = (size: number): boolean => {
    ctx.doc.font(PDF_FONTS.bold).fontSize(size);
    return columns.every((column) => {
      const padding = column.key === 'event' ? CELL_PADDING_X * 2 : HEADER_PADDING * 2;
      return ctx.doc.widthOfString(column.label) <= column.width - padding;
    });
  };

  if (fits(7.5)) return 7.5;
  return 7;
}

function drawHeader(ctx: PdfContext, y: number, columns: ReportColumn[]): number {
  const { doc } = ctx;
  const fontSize = headerFontSize(ctx, columns);

  doc.rect(ctx.left, y, ctx.width, HEADER_HEIGHT).fillColor(PDF_COLORS.brand).fill();
  doc.font(PDF_FONTS.bold).fontSize(fontSize).fillColor(PDF_COLORS.white);
  const lineHeight = doc.currentLineHeight();

  let x = ctx.left;
  for (const column of columns) {
    const padding = column.key === 'event' ? CELL_PADDING_X : HEADER_PADDING;
    doc.text(column.label, x + padding, y + (HEADER_HEIGHT - lineHeight) / 2, {
      width: column.width - padding * 2,
      align: column.align,
      lineBreak: false,
    });
    x += column.width;
  }

  return y + HEADER_HEIGHT;
}

function eventTitleHeight(ctx: PdfContext, event: EventReportRow, width: number): number {
  const { doc } = ctx;
  doc.font(PDF_FONTS.bold).fontSize(9);
  const lineHeight = doc.currentLineHeight();
  const measured = doc.heightOfString(event.title, { width });

  return Math.min(measured, lineHeight * 2);
}

function rowHeight(ctx: PdfContext, event: EventReportRow, titleWidth: number): number {
  const { doc } = ctx;
  const titleHeight = eventTitleHeight(ctx, event, titleWidth);

  doc.font(PDF_FONTS.regular).fontSize(7.5);
  const dateHeight = event.startsAt ? doc.currentLineHeight() : 0;
  const gap = event.startsAt ? 2 : 0;

  return Math.max(MIN_ROW_HEIGHT, titleHeight + gap + dateHeight + CELL_PADDING_Y * 2);
}

function drawEventCell(
  ctx: PdfContext,
  event: EventReportRow,
  x: number,
  y: number,
  width: number,
  height: number,
  titleHeight: number
): void {
  const { doc } = ctx;
  const textWidth = width - CELL_PADDING_X * 2;
  const gap = event.startsAt ? 2 : 0;

  doc.font(PDF_FONTS.regular).fontSize(7.5);
  const dateHeight = event.startsAt ? doc.currentLineHeight() : 0;
  const contentHeight = titleHeight + gap + dateHeight;
  const top = y + (height - contentHeight) / 2;

  doc
    .font(PDF_FONTS.bold)
    .fontSize(9)
    .fillColor(PDF_COLORS.ink)
    .text(event.title, x + CELL_PADDING_X, top, {
      width: textWidth,
      height: titleHeight,
      ellipsis: true,
      lineBreak: true,
    });

  if (event.startsAt) {
    doc
      .font(PDF_FONTS.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.muted)
      .text(
        formatWeekdayDateTime(event.startsAt),
        x + CELL_PADDING_X,
        top + titleHeight + gap,
        { width: textWidth, lineBreak: false, ellipsis: true }
      );
  }
}

function drawStatusCell(
  ctx: PdfContext,
  status: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const { doc } = ctx;
  const style = statusStyle(status);
  const label = statusLabel(status);
  const chipHeight = 14;

  doc.font(PDF_FONTS.bold).fontSize(7.5);
  const chipWidth = Math.min(doc.widthOfString(label) + 16, width - 8);
  const chipX = x + (width - chipWidth) / 2;
  const chipY = y + (height - chipHeight) / 2;
  const lineHeight = doc.currentLineHeight();

  doc
    .roundedRect(chipX, chipY, chipWidth, chipHeight, 4)
    .fillColor(style.background)
    .fill();
  doc
    .font(PDF_FONTS.bold)
    .fontSize(7.5)
    .fillColor(style.text)
    .text(label, chipX + 8, chipY + (chipHeight - lineHeight) / 2, {
      width: chipWidth - 16,
      align: 'center',
      lineBreak: false,
    });
}

function drawNumberCell(
  ctx: PdfContext,
  value: number,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
  bold = true
): void {
  const { doc } = ctx;
  const isZero = value === 0;

  doc
    .font(isZero || !bold ? PDF_FONTS.regular : PDF_FONTS.bold)
    .fontSize(9.5)
    .fillColor(isZero ? ZERO_COLOR : color);
  const lineHeight = doc.currentLineHeight();

  doc.text(formatReportCount(value), x, y + (height - lineHeight) / 2, {
    width,
    align: 'center',
    lineBreak: false,
  });
}

function drawRateCell(
  ctx: PdfContext,
  rate: number,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const { doc } = ctx;
  const barX = x + 3;
  const barY = y + (height - RATE_BAR_HEIGHT) / 2;

  doc
    .roundedRect(barX, barY, RATE_BAR_WIDTH, RATE_BAR_HEIGHT, RATE_BAR_HEIGHT / 2)
    .fillColor(PDF_COLORS.line)
    .fill();

  if (rate > 0) {
    doc
      .roundedRect(
        barX,
        barY,
        Math.max(2, RATE_BAR_WIDTH * Math.min(rate, 1)),
        RATE_BAR_HEIGHT,
        RATE_BAR_HEIGHT / 2
      )
      .fillColor(RATE_COLOR)
      .fill();
  }

  doc.font(PDF_FONTS.bold).fontSize(9).fillColor(PDF_COLORS.brand);
  const lineHeight = doc.currentLineHeight();
  doc.text(formatReportPercent(rate), x + 40, y + (height - lineHeight) / 2, {
    width: width - 44,
    align: 'right',
    lineBreak: false,
  });
}

function drawRow(
  ctx: PdfContext,
  event: EventReportRow,
  columns: ReportColumns,
  y: number,
  height: number,
  index: number
): void {
  const { doc } = ctx;

  if (index % 2 === 1) {
    doc.save();
    doc
      .rect(ctx.left, y, ctx.width, height)
      .fillColor(PDF_COLORS.brand)
      .fillOpacity(0.04)
      .fill();
    doc.restore();
  }

  const eventWidth = columns[0].width;
  const titleHeight = eventTitleHeight(ctx, event, eventWidth - CELL_PADDING_X * 2);

  let x = ctx.left;
  drawEventCell(ctx, event, x, y, eventWidth, height, titleHeight);
  x += eventWidth;

  drawStatusCell(ctx, event.status, x, y, columns[1].width, height);
  x += columns[1].width;

  drawNumberCell(
    ctx,
    event.totalInvitations,
    PDF_COLORS.brand,
    x,
    y,
    columns[2].width,
    height
  );
  x += columns[2].width;

  drawNumberCell(ctx, event.accepted, NUMBER_COLORS.accepted, x, y, columns[3].width, height);
  x += columns[3].width;

  drawNumberCell(ctx, event.pending, NUMBER_COLORS.pending, x, y, columns[4].width, height);
  x += columns[4].width;

  drawNumberCell(ctx, event.declined, NUMBER_COLORS.declined, x, y, columns[5].width, height);
  x += columns[5].width;

  drawRateCell(ctx, reportResponseRate(event), x, y, columns[6].width, height);

  doc
    .moveTo(ctx.left, y + height)
    .lineTo(ctx.left + ctx.width, y + height)
    .lineWidth(0.5)
    .strokeColor(PDF_COLORS.line)
    .stroke();
}

function drawEmptyState(ctx: PdfContext, y: number, message: string): number {
  const { doc } = ctx;
  const height = 54;

  doc.save();
  doc
    .roundedRect(ctx.left, y, ctx.width, height, 6)
    .fillColor(PDF_COLORS.brand)
    .fillOpacity(0.04)
    .fill();
  doc.restore();

  doc.font(PDF_FONTS.regular).fontSize(10).fillColor(PDF_COLORS.muted);
  const lineHeight = doc.currentLineHeight();
  doc.text(message, ctx.left, y + (height - lineHeight) / 2, {
    width: ctx.width,
    align: 'center',
    lineBreak: false,
  });

  return y + height + 12;
}

function totalsFor(events: EventReportRow[]): EventReportRow {
  const totals = events.reduce(
    (acc, event) => ({
      totalInvitations: acc.totalInvitations + event.totalInvitations,
      accepted: acc.accepted + event.accepted,
      pending: acc.pending + event.pending,
      declined: acc.declined + event.declined,
    }),
    { totalInvitations: 0, accepted: 0, pending: 0, declined: 0 }
  );

  return {
    eventId: '',
    title: 'Total',
    status: 'draft',
    startsAt: null,
    ...totals,
  };
}

function drawTotals(
  ctx: PdfContext,
  totals: EventReportRow,
  columns: ReportColumns,
  y: number
): number {
  const { doc } = ctx;

  doc.save();
  doc
    .rect(ctx.left, y, ctx.width, TOTALS_HEIGHT)
    .fillColor(PDF_COLORS.brand)
    .fillOpacity(0.08)
    .fill();
  doc.restore();

  doc
    .moveTo(ctx.left, y)
    .lineTo(ctx.left + ctx.width, y)
    .lineWidth(1)
    .strokeColor(PDF_COLORS.brand)
    .stroke();

  doc.font(PDF_FONTS.extraBold).fontSize(9).fillColor(PDF_COLORS.brand);
  const labelLine = doc.currentLineHeight();
  doc.text('Total', ctx.left + CELL_PADDING_X, y + (TOTALS_HEIGHT - labelLine) / 2, {
    width: columns[0].width - CELL_PADDING_X * 2,
    lineBreak: false,
  });

  let x = ctx.left + columns[0].width + columns[1].width;

  const numeric: Array<{ value: number; width: number; color: string }> = [
    { value: totals.totalInvitations, width: columns[2].width, color: PDF_COLORS.brand },
    { value: totals.accepted, width: columns[3].width, color: NUMBER_COLORS.accepted },
    { value: totals.pending, width: columns[4].width, color: NUMBER_COLORS.pending },
    { value: totals.declined, width: columns[5].width, color: NUMBER_COLORS.declined },
  ];

  for (const item of numeric) {
    drawNumberCell(ctx, item.value, item.color, x, y, item.width, TOTALS_HEIGHT, true);
    x += item.width;
  }

  drawRateCell(
    ctx,
    reportResponseRate(totals),
    x,
    y,
    columns[6].width,
    TOTALS_HEIGHT
  );

  return y + TOTALS_HEIGHT;
}

/**
 * Tabela dedicada do relatório de eventos.
 *
 * O cabeçalho repete em cada página, as linhas nunca são partidas e a
 * linha de totais aparece apenas no fim (última página). Devolve o Y
 * depois da tabela.
 */
export function drawReportTable(
  ctx: PdfContext,
  y: number,
  events: EventReportRow[],
  emptyMessage = 'Ainda não há eventos nesta conta.'
): number {
  const { doc } = ctx;
  const columns = columnsFor(ctx);

  if (events.length === 0) {
    return drawEmptyState(ctx, y, emptyMessage);
  }

  for (const event of events) {
    if (!reportRowIsConsistent(event)) {
      logger.warn(
        {
          eventId: event.eventId,
          totalInvitations: event.totalInvitations,
          accepted: event.accepted,
          pending: event.pending,
          declined: event.declined,
        },
        'Relatório: Confirmados + Pendentes + Recusados não iguala Convites.'
      );
    }
  }

  const titleWidth = columns[0].width - CELL_PADDING_X * 2;
  let cursor = drawHeader(ctx, y, columns);

  events.forEach((event, index) => {
    const height = rowHeight(ctx, event, titleWidth);

    if (cursor + height > ctx.contentBottom) {
      doc.addPage();
      cursor = drawHeader(ctx, ctx.contentTop, columns);
    }

    drawRow(ctx, event, columns, cursor, height, index);
    cursor += height;
  });

  if (cursor + TOTALS_HEIGHT > ctx.contentBottom) {
    doc.addPage();
    cursor = drawHeader(ctx, ctx.contentTop, columns);
  }

  return drawTotals(ctx, totalsFor(events), columns, cursor);
}
