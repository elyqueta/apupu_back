import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import SVGtoPDF from 'svg-to-pdfkit';
import { EventRecord } from '../../types/event.types';
import { Invitation } from '../../types/invitation.types';
import { TemplateManifest } from '../../types/templateManifest';
import { formatDisplayDateTime } from '../../utils/exportFormat.util';
import { mm, registerFonts, PDF_FONTS } from './pdfTheme';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bloco 14 — PDF "Convite" (substitui o "Bilhete de convite").
 *
 * Segue o manifesto do template (paleta, fontes, moldura, ornamentos e
 * posição do QR). Sem data de geração em destaque, sem estado de resposta
 * e sem "Respondeu em". A mesa só aparece com mesas ativas no evento.
 * Texto em fluxo: endereços e nomes longos crescem sem sobrepor blocos e,
 * se necessário, continuam na página seguinte com o mesmo fundo.
 */

export interface InvitationLine {
  block: 'title' | 'host' | 'datetime' | 'location' | 'deadline' | 'message' | 'guest' | 'table';
  label?: string;
  text: string;
}

function locationText(event: EventRecord): string {
  if (event.location.type === 'online') return 'Online';
  const parts = [event.location.name, event.location.address].filter(
    (part): part is string => Boolean(part && part.trim())
  );
  return parts.length > 0 ? parts.join('\n') : 'Local a confirmar';
}

/** Linhas do convite pela ordem do manifesto (testável sem gerar o PDF). */
export function invitationLines(
  event: EventRecord,
  invitation: Invitation,
  manifest: TemplateManifest
): InvitationLine[] {
  const lines: InvitationLine[] = [];
  for (const block of manifest.layout.blocks) {
    switch (block) {
      case 'title':
        lines.push({ block, text: event.title });
        break;
      case 'host':
        lines.push({ block, label: 'Anfitrião', text: event.hostName });
        break;
      case 'datetime':
        lines.push({ block, label: 'Quando', text: formatDisplayDateTime(event.startsAt) });
        break;
      case 'location':
        lines.push({ block, label: 'Onde', text: locationText(event) });
        break;
      case 'deadline':
        if (event.rsvpDeadline) {
          lines.push({ block, label: 'Responda até', text: formatDisplayDateTime(event.rsvpDeadline) });
        }
        break;
      case 'message':
        if (event.message?.trim()) lines.push({ block, text: event.message.trim() });
        break;
    }
  }
  lines.push({ block: 'guest', label: 'Convidado', text: invitation.guestName });
  if (event.useTables && invitation.tableName?.trim()) {
    lines.push({ block: 'table', label: 'Mesa', text: invitation.tableName.trim() });
  }
  return lines;
}

type FontRole = TemplateManifest['fonts']['display'];

/** Fontes embebidas (Figtree) ou padrão do PDF (Times), sempre disponíveis. */
function fontFor(role: FontRole, weight: 'regular' | 'bold'): string {
  switch (role) {
    case 'script':
      return weight === 'bold' ? 'Times-BoldItalic' : 'Times-Italic';
    case 'serif':
      return weight === 'bold' ? 'Times-Bold' : 'Times-Roman';
    case 'cap':
      return 'Times-Bold';
    default:
      return weight === 'bold' ? PDF_FONTS.extraBold : PDF_FONTS.regular;
  }
}

let symbolCache: string | null = null;
function symbolSvg(): string {
  if (!symbolCache) {
    symbolCache = readFileSync(join(__dirname, '..', '..', 'assets', 'pdf', 'watermark-symbol.svg'), 'utf8');
  }
  return symbolCache;
}

function drawBackground(doc: PDFKit.PDFDocument, manifest: TemplateManifest): void {
  const { width, height } = doc.page;
  doc.save();
  doc.rect(0, 0, width, height).fill(manifest.palette.bg);
  const inset = mm(10);
  if (manifest.pdf.frame !== 'none') {
    doc.lineWidth(1).strokeColor(manifest.palette.accent);
    doc.rect(inset, inset, width - inset * 2, height - inset * 2).stroke();
    if (manifest.pdf.frame === 'double') {
      const inner = inset + mm(2);
      doc.lineWidth(0.5).rect(inner, inner, width - inner * 2, height - inner * 2).stroke();
    }
  }
  if (manifest.pdf.show_ornaments && manifest.ornaments.corners !== 'none') {
    drawCorners(doc, manifest, inset + mm(4));
  }
  doc.restore();
}

/** Cantos desenhados (vetor próprio): arcos e folhas simples. */
function drawCorners(doc: PDFKit.PDFDocument, manifest: TemplateManifest, offset: number): void {
  const { width, height } = doc.page;
  const size = mm(14);
  const corners: Array<[number, number, number, number]> = [
    [offset, offset, 1, 1],
    [width - offset, offset, -1, 1],
    [offset, height - offset, 1, -1],
    [width - offset, height - offset, -1, -1],
  ];
  doc.strokeColor(manifest.palette.accent).fillColor(manifest.palette.accent).lineWidth(0.8);
  for (const [x, y, sx, sy] of corners) {
    doc
      .moveTo(x, y + sy * size)
      .quadraticCurveTo(x, y, x + sx * size, y)
      .stroke();
    doc
      .moveTo(x + sx * mm(3), y + sy * size * 0.7)
      .quadraticCurveTo(x + sx * mm(3), y + sy * mm(3), x + sx * size * 0.7, y + sy * mm(3))
      .stroke();
    doc.circle(x + sx * mm(5), y + sy * mm(5), 1.6).fill();
  }
}

function drawDivider(doc: PDFKit.PDFDocument, manifest: TemplateManifest, x: number, width: number): void {
  if (manifest.ornaments.divider === 'none') return;
  const y = doc.y + mm(2);
  const center = manifest.layout.align === 'center' ? x + width / 2 : x + mm(15);
  doc.save().strokeColor(manifest.palette.accent).fillColor(manifest.palette.accent).lineWidth(0.6);
  doc.moveTo(center - mm(15), y).lineTo(center + mm(15), y).stroke();
  if (manifest.ornaments.divider !== 'line') doc.circle(center, y, 1.8).fill();
  doc.restore();
  doc.y = y + mm(4);
}

/** QR com o logo ao centro (correção H; logo ≈ 5% da área, fundo branco). */
async function drawQrWithLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number, url: string, color: string): Promise<void> {
  const buffer = await QRCode.toBuffer(url, {
    type: 'png',
    margin: 0,
    width: 600,
    errorCorrectionLevel: 'H',
    color: { dark: color, light: '#FFFFFF' },
  });
  const quiet = mm(3);
  doc.save();
  doc.roundedRect(x, y, size, size, mm(2)).fill('#FFFFFF');
  doc.image(buffer, x + quiet, y + quiet, { width: size - quiet * 2, height: size - quiet * 2 });
  const logo = (size - quiet * 2) * 0.22;
  const lx = x + (size - logo) / 2;
  const ly = y + (size - logo) / 2;
  doc.roundedRect(lx - 2, ly - 2, logo + 4, logo + 4, 3).fill('#FFFFFF');
  SVGtoPDF(doc, symbolSvg(), lx + logo * 0.15, ly + logo * 0.05, { width: logo * 0.7, height: logo * 0.9 });
  doc.restore();
}

export function renderInvitationPdf(
  event: EventRecord,
  invitation: Invitation,
  manifest: TemplateManifest,
  invitationUrl: string | null
): Promise<Buffer> {
  const margin = mm(26);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    info: { Title: `Convite — ${event.title}`, Subject: 'Convite', Author: 'Conto Contigo', Creator: 'Conto Contigo' },
    autoFirstPage: false,
  });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  // Páginas seguintes (conteúdo longo) mantêm o fundo e a moldura.
  doc.on('pageAdded', () => {
    drawBackground(doc, manifest);
    doc.x = margin;
    doc.y = margin;
  });

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  void (async () => {
    try {
      doc.addPage();
      const width = doc.page.width - margin * 2;
      const align = manifest.layout.align;
      const { ink, muted, accent } = manifest.palette;
      const display = manifest.fonts.display;
      const body = manifest.fonts.body;

      doc.font(fontFor(body, 'regular')).fontSize(10).fillColor(muted);
      doc.text(display === 'cap' ? 'CONVITE' : 'Convite', margin, margin, { width, align, characterSpacing: 2 });
      doc.moveDown(0.8);

      for (const line of invitationLines(event, invitation, manifest)) {
        if (line.block === 'title') {
          const text = display === 'cap' ? line.text.toUpperCase() : line.text;
          doc.font(fontFor(display, 'bold')).fontSize(display === 'script' ? 34 : 28).fillColor(ink);
          doc.text(text, margin, doc.y, { width, align, lineGap: 2 });
          drawDivider(doc, manifest, margin, width);
          continue;
        }
        if (line.block === 'message') {
          doc.moveDown(0.4);
          doc.font(fontFor(body, 'regular')).fontSize(11).fillColor(ink);
          doc.text(line.text, margin, doc.y, { width, align, lineGap: 3 });
          doc.moveDown(0.6);
          continue;
        }
        if (line.block === 'guest') drawDivider(doc, manifest, margin, width);
        if (line.label) {
          doc.font(fontFor(body, 'bold')).fontSize(9).fillColor(accent);
          doc.text(line.label.toUpperCase(), margin, doc.y, { width, align, characterSpacing: 1.2 });
        }
        doc.font(fontFor(body, 'regular')).fontSize(line.block === 'guest' ? 15 : 12.5).fillColor(ink);
        doc.text(line.text, margin, doc.y, { width, align, lineGap: 2 });
        doc.moveDown(0.7);
      }

      if (invitationUrl) {
        const size = mm(36);
        if (doc.y + size + mm(14) > doc.page.height - margin) doc.addPage();
        const y = doc.y + mm(4);
        const position = manifest.pdf.qr_position;
        const x =
          position === 'bottom-center'
            ? margin + (width - size) / 2
            : position === 'bottom-left'
              ? margin
              : margin + width - size;
        await drawQrWithLogo(doc, x, y, size, invitationUrl, ink);
        doc.font(fontFor(body, 'regular')).fontSize(9).fillColor(muted);
        doc.text('Leia o código para abrir o seu convite.', margin, y + size + mm(2), {
          width,
          align: position === 'bottom-center' ? 'center' : position === 'bottom-left' ? 'left' : 'right',
        });
      }
      doc.end();
    } catch (error) {
      doc.emit('error', error);
    }
  })();

  return done;
}
