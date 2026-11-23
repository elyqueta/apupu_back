import { toInvitationDto } from '../../dto/invitation.dto';
import { EventRecord, EventStats } from '../../types/event.types';
import { Invitation } from '../../types/invitation.types';
import {
  documentCode,
  eventStatusLabel,
  formatAngolaPhone,
  formatDisplayDateTime,
  rsvpStatusLabel,
} from '../../utils/exportFormat.util';
import {
  DonutDatum,
  drawDonut,
  drawHighlightBlock,
  drawQr,
  drawSectionTitle,
  drawTable,
  drawTitle,
  PdfContext,
  PdfMeta,
  StatusTone,
  TableCell,
  TableColumn,
  renderPdf,
} from './pdfLayout';
import { PDF_COLORS, mm } from './pdfTheme';

function statusTone(status: string): StatusTone {
  if (status === 'accepted') return 'confirmed';
  if (status === 'declined') return 'declined';
  return 'pending';
}

function locationLabel(event: EventRecord): string {
  if (event.location.type === 'online') {
    return 'Online';
  }

  const parts = [event.location.name, event.location.address].filter(
    (part): part is string => Boolean(part && part.trim())
  );
  return parts.length > 0 ? parts.join(' · ') : 'Local a confirmar';
}

function eventSubtitle(event: EventRecord): string[] {
  return [
    event.title,
    `${formatDisplayDateTime(event.startsAt)} · ${locationLabel(event)}`,
  ];
}

function metaFor(
  documentType: string,
  prefix: string,
  event: EventRecord,
  generatedAt: Date,
  subject: string
): PdfMeta {
  return {
    documentType,
    documentCode: documentCode(prefix, event.id, generatedAt),
    generatedAt,
    title: `${documentType} — ${event.title}`,
    subject,
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function responseRate(stats: EventStats): number {
  if (stats.totalInvitations === 0) return 0;
  return (stats.accepted + stats.declined) / stats.totalInvitations;
}

function acceptanceRate(stats: EventStats): number {
  if (stats.totalInvitations === 0) return 0;
  return stats.accepted / stats.totalInvitations;
}

function guestTableColumns(): TableColumn[] {
  // A largura útil é ~482 pt; os pesos são proporcionais a ela.
  return [
    { label: 'Nome', weight: 82 },
    { label: 'Telemóvel', weight: 86 },
    { label: 'E-mail', weight: 116 },
    { label: 'Estado', weight: 70 },
    { label: 'Mesa', weight: 46 },
    { label: 'Respondeu em', weight: 86 },
  ];
}

function guestTableRows(guests: Invitation[]): TableCell[][] {
  return guests.map((guest) => [
    guest.guestName,
    formatAngolaPhone(guest.guestPhone) || '—',
    guest.guestEmail ?? '—',
    { text: rsvpStatusLabel(guest.rsvpStatus), tone: statusTone(guest.rsvpStatus) },
    guest.tableName ?? '—',
    guest.rsvpRespondedAt ? formatDisplayDateTime(guest.rsvpRespondedAt) : '—',
  ]);
}

function attendanceColumns(): TableColumn[] {
  return [
    { label: 'Nome', weight: 110 },
    { label: 'E-mail', weight: 150 },
    { label: 'Telemóvel', weight: 88 },
    { label: 'Mesa', weight: 52 },
    { label: 'Respondeu em', weight: 105 },
  ];
}

function attendanceRows(guests: Invitation[]): TableCell[][] {
  return guests.map((guest) => [
    guest.guestName,
    guest.guestEmail ?? '—',
    formatAngolaPhone(guest.guestPhone) || '—',
    guest.tableName ?? '—',
    guest.rsvpRespondedAt ? formatDisplayDateTime(guest.rsvpRespondedAt) : '—',
  ]);
}

function detailColumns(): TableColumn[] {
  return [
    { label: 'Detalhe', weight: 1 },
    { label: 'Informação', weight: 2.4 },
  ];
}

function donutData(stats: EventStats): DonutDatum[] {
  return [
    {
      key: 'confirmed',
      label: 'Confirmado',
      value: stats.accepted,
      color: PDF_COLORS.confirmedText,
    },
    {
      key: 'pending',
      label: 'Pendente',
      value: stats.pending,
      color: PDF_COLORS.pendingText,
    },
    {
      key: 'declined',
      label: 'Recusado',
      value: stats.declined,
      color: PDF_COLORS.declinedText,
    },
  ];
}

/** Lista de convidados e respostas. */
export function renderGuestsPdf(
  event: EventRecord,
  guests: Invitation[],
  stats: EventStats,
  generatedAt: Date
): Promise<Buffer> {
  const meta = metaFor(
    'Lista de convidados',
    'CC-LST',
    event,
    generatedAt,
    'Lista de convidados e respostas aos convites'
  );

  return renderPdf(meta, (ctx: PdfContext) => {
    const y = drawTitle(ctx, 'Lista de convidados', eventSubtitle(event));
    const afterHighlight = drawHighlightBlock(ctx, y, [
      { label: 'Convites', value: String(stats.totalInvitations) },
      { label: 'Confirmados', value: String(stats.accepted) },
      { label: 'Pendentes', value: String(stats.pending) },
      { label: 'Recusados', value: String(stats.declined) },
    ]);

    drawTable(ctx, afterHighlight, guestTableColumns(), guestTableRows(guests), {
      emptyMessage: 'Ainda não há convidados',
      fontSize: 8,
    });
  });
}

/** Relatório de presenças: convidados confirmados (não há check-in). */
export function renderAttendancePdf(
  event: EventRecord,
  guests: Invitation[],
  stats: EventStats,
  generatedAt: Date
): Promise<Buffer> {
  const meta = metaFor(
    'Relatório de presenças',
    'CC-PRE',
    event,
    generatedAt,
    'Presenças confirmadas com base nas respostas ao convite'
  );
  const confirmed = guests.filter((guest) => guest.rsvpStatus === 'accepted');

  return renderPdf(meta, (ctx: PdfContext) => {
    const y = drawTitle(ctx, 'Relatório de presenças', [
      ...eventSubtitle(event),
      'Presenças confirmadas com base nas respostas ao convite.',
    ]);
    const afterHighlight = drawHighlightBlock(ctx, y, [
      { label: 'Confirmados', value: String(stats.accepted) },
      { label: 'Total de convites', value: String(stats.totalInvitations) },
      { label: 'Taxa de confirmação', value: percent(acceptanceRate(stats)) },
    ]);

    drawTable(ctx, afterHighlight, attendanceColumns(), attendanceRows(confirmed), {
      emptyMessage: 'Ainda não há convidados',
      fontSize: 8,
    });
  });
}

/** Resumo do evento com o mesmo gráfico circular dos relatórios. */
export function renderEventSummaryPdf(
  event: EventRecord,
  stats: EventStats,
  generatedAt: Date
): Promise<Buffer> {
  const meta = metaFor(
    'Resumo do evento',
    'CC-RES',
    event,
    generatedAt,
    'Resumo do evento, convites e respostas'
  );

  return renderPdf(meta, (ctx: PdfContext) => {
    const y = drawTitle(ctx, 'Resumo do evento', eventSubtitle(event));
    const afterHighlight = drawHighlightBlock(ctx, y, [
      { label: 'Convites', value: String(stats.totalInvitations) },
      { label: 'Confirmados', value: String(stats.accepted) },
      { label: 'Pendentes', value: String(stats.pending) },
      { label: 'Recusados', value: String(stats.declined) },
    ]);

    const afterDonut = drawDonut(ctx, afterHighlight, donutData(stats));
    const detailsY = drawSectionTitle(ctx, afterDonut, 'Detalhes do evento');

    drawTable(ctx, detailsY, detailColumns(), [
      ['Evento', event.title],
      ['Data', formatDisplayDateTime(event.startsAt)],
      ['Local', locationLabel(event)],
      ['Anfitrião', event.hostName],
      ['Estado', eventStatusLabel(event.status)],
      [
        'Prazo de resposta',
        event.rsvpDeadline ? formatDisplayDateTime(event.rsvpDeadline) : 'Sem prazo definido',
      ],
      ['Taxa de resposta', percent(responseRate(stats))],
      ['Taxa de confirmação', percent(acceptanceRate(stats))],
    ]);
  });
}

/** Bilhete individual com o QR do link do convite. */
export function renderTicketPdf(
  event: EventRecord,
  invitation: Invitation,
  generatedAt: Date
): Promise<Buffer> {
  const meta = metaFor(
    'Bilhete de convite',
    'CC-BIL',
    event,
    generatedAt,
    'Bilhete individual com QR do convite'
  );

  return renderPdf(meta, async (ctx: PdfContext) => {
    const y = drawTitle(ctx, 'Bilhete de convite', eventSubtitle(event));
    const afterHighlight = drawHighlightBlock(ctx, y, [
      { label: 'Data', value: formatDisplayDateTime(event.startsAt) },
      { label: 'Local', value: locationLabel(event) },
      { label: 'Estado', value: rsvpStatusLabel(invitation.rsvpStatus) },
    ]);

    const detailsY = drawSectionTitle(ctx, afterHighlight, 'Convidado');
    const afterDetails = drawTable(ctx, detailsY, detailColumns(), [
      ['Nome', invitation.guestName],
      ['E-mail', invitation.guestEmail ?? '—'],
      ['Telemóvel', formatAngolaPhone(invitation.guestPhone) || '—'],
      ['Mesa', invitation.tableName ?? '—'],
      [
        'Respondeu em',
        invitation.rsvpRespondedAt
          ? formatDisplayDateTime(invitation.rsvpRespondedAt)
          : 'Ainda não respondeu',
      ],
    ]);

    const qrSize = mm(32);
    const qrX = ctx.left + ctx.width - qrSize;
    const qrY = afterDetails + mm(2);
    const invitationUrl = toInvitationDto(invitation).invitation_url;

    ctx.doc
      .font('Figtree-Bold')
      .fontSize(12)
      .fillColor(PDF_COLORS.brand)
      .text('Apresenta este bilhete à entrada.', ctx.left, qrY + mm(2), {
        width: ctx.width - qrSize - mm(6),
      });
    ctx.doc
      .font('Figtree')
      .fontSize(9)
      .fillColor(PDF_COLORS.muted)
      .text(
        `Gerado em ${formatDisplayDateTime(generatedAt)}. O QR abre a página do convite.`,
        ctx.left,
        qrY + mm(9),
        { width: ctx.width - qrSize - mm(6) }
      );

    if (invitationUrl) {
      await drawQr(ctx, qrX, qrY, invitationUrl, qrSize);
    } else {
      ctx.doc
        .font('Figtree')
        .fontSize(9)
        .fillColor(PDF_COLORS.declinedText)
        .text('Link do convite indisponível.', qrX, qrY + 12, {
          width: qrSize,
          align: 'center',
        });
    }
  });
}
