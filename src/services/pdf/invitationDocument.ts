import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import SVGtoPDF from 'svg-to-pdfkit';
import { EventRecord } from '../../types/event.types';
import { Invitation } from '../../types/invitation.types';
import { TemplateManifest } from '../../types/templateManifest';
import { formatDisplayDateTime } from '../../utils/exportFormat.util';
import { links } from '../../utils/links.util';
import { mm, registerFonts, resolveCatalogFont } from './pdfTheme';
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

/** Fontes embutidas do catálogo local (Bloco 15). Nunca substituição silenciosa. */
function fontFor(role: string, weight: 'regular' | 'bold'): string {
  return resolveCatalogFont(role, weight === 'bold' ? 'bold' : 'regular');
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

/** QR estilizado (Bloco 15): cartão arredondado, borda fina, logo central, H ECC, legenda. */
async function drawQrWithLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number,
  url: string,
  color: string,
  accent: string,
  legend?: string
): Promise<void> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    width: 600,
    errorCorrectionLevel: 'H',
    color: { dark: color, light: '#0000' },
  });
  // Cantos ligeiramente arredondados nos módulos (substitui <rect .../> por rx/ry pequenos).
  const roundedSvg = svg.replace(/<rect([^>]*?)\/>/g, (m, attrs: string) => {
    if (/rx=/.test(attrs)) return m;
    return `<rect${attrs} rx="0.8" ry="0.8"/>`;
  });

  const quiet = mm(3);
  const cardR = mm(3);
  doc.save();
  // Cartão branco com borda fina dourada/cor do template.
  doc.roundedRect(x, y, size, size, cardR).fillAndStroke('#FFFFFF', accent);
  doc.lineWidth(0.6).strokeColor(accent).roundedRect(x, y, size, size, cardR).stroke();

  const qrSize = size - quiet * 2;
  SVGtoPDF(doc, roundedSvg, x + quiet, y + quiet, { width: qrSize, height: qrSize });

  // Ícone da plataforma ao centro com fundo branco.
  const logo = qrSize * 0.22;
  const lx = x + (size - logo) / 2;
  const ly = y + (size - logo) / 2;
  doc.roundedRect(lx - 2, ly - 2, logo + 4, logo + 4, 3).fill('#FFFFFF');
  SVGtoPDF(doc, symbolSvg(), lx + logo * 0.15, ly + logo * 0.05, { width: logo * 0.7, height: logo * 0.9 });

  if (legend) {
    doc.font(resolveCatalogFont('sans', 'regular')).fontSize(7).fillColor(accent);
    doc.text(legend.toUpperCase(), x, y - mm(4), { width: size, align: 'center', characterSpacing: 0.8 });
  }
  doc.restore();
}

function isGratitude(manifest: TemplateManifest): boolean {
  return manifest.ornaments.frame === 'gratitude' || manifest.ornaments.corners === 'gratitude';
}

function gratTitle(event: EventRecord): string {
  return (event.title || 'GRATITUDE').toUpperCase();
}

async function renderGratitudePdf(
  event: EventRecord,
  _invitation: Invitation,
  manifest: TemplateManifest,
  invitationUrl: string | null
): Promise<Buffer> {
  const width = 595.28;
  const height = 841.89;
  const doc = new PDFDocument({ size: [width, height], margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: { Title: `Convite — ${event.title}`, Author: 'Conto Contigo' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const bg = manifest.palette.bg || '#FFF6EA';
  const ink = manifest.palette.ink || '#1A120B';
  const accent = manifest.palette.accent || '#C8922A';
  const muted = manifest.palette.muted || '#7A6248';
  const d = event.startsAt ? new Date(event.startsAt) : null;
  const dateShort = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '20/12';
  const timeShort = d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '14:00';
  const year = d ? String(d.getFullYear()) : '2026';
  const local = (event.location?.name || event.location?.address || 'Local a confirmar').slice(0, 38);
  const org = (event.hostName || 'ORGANIZAÇÃO').toUpperCase();
  const subtitle = (event.title ? 'CELEBRAÇÃO ESPECIAL' : 'FESTIVAL DE ADOLESCENTES').toUpperCase();
  const dress = ((event as any).dressCode || 'TRAJE AFRICANO').toUpperCase();
  const qrDestination = (manifest.pdf as any).qr_destination as string | undefined;
  const qrCustom = (manifest.pdf as any).qr_custom_url as string | undefined;
  const eventPublicUrl = (event as any).publicSlug ? links.publicEvent((event as any).publicSlug) : null;
  const qrUrl = qrDestination === 'custom' && qrCustom ? qrCustom : qrDestination === 'event' ? eventPublicUrl || invitationUrl : invitationUrl || eventPublicUrl;

  const pattern = `<pattern id="af" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M20 0 L40 20 L20 40 L0 20 Z" fill="none" stroke="#8A1C1C" stroke-width="2"/><path d="M20 8 L32 20 L20 32 L8 20 Z" fill="#1F7A3A"/><path d="M20 14 L26 20 L20 26 L14 20 Z" fill="#F2C14E"/><path d="M0 0 L10 10 M40 0 L30 10 M0 40 L10 30 M40 40 L30 30" stroke="#E07A2F" stroke-width="2"/></pattern>`;
  const warm = `<pattern id="aw" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M20 0 L40 20 L20 40 L0 20 Z" fill="none" stroke="#2E1A12" stroke-width="1.5"/><path d="M20 6 L34 20 L20 34 L6 20 Z" fill="#8A1C1C"/><path d="M20 12 L28 20 L20 28 L12 20 Z" fill="#F2C14E"/><path d="M20 16 L24 20 L20 24 L16 20 Z" fill="#1F7A3A"/></pattern>`;
  const gold = `<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#F6E27A"/><stop offset="35%" stop-color="#D4AF37"/><stop offset="65%" stop-color="#FFF0A8"/><stop offset="100%" stop-color="#B8860B"/></linearGradient>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1280" width="1024" height="1280">
  <defs>${pattern}${warm}${gold}<radialGradient id="glow" cx="50%" cy="45%" r="55%"><stop offset="0%" stop-color="#FFFDF7"/><stop offset="100%" stop-color="${bg}" stop-opacity="0"/></radialGradient></defs>
  <rect width="1024" height="1280" fill="${bg}"/><rect width="1024" height="1280" fill="url(#glow)"/>
  <g opacity="0.1"><rect x="680" y="-40" width="420" height="420" fill="url(#af)"/><rect x="-60" y="900" width="420" height="420" fill="url(#af)"/></g>
  <g transform="translate(-20,-10) rotate(-2 180 140)"><path d="M-40 170 C120 40, 240 20, 420 30 L400 95 C250 85, 150 105, -20 220 Z" fill="url(#aw)"/><path d="M-40 170 C120 40, 240 20, 420 30 L412 52 C245 42, 130 58, -30 192 Z" fill="url(#gold)"/><path d="M-20 220 C150 105, 250 85, 400 95 L392 115 C250 105, 155 125, -10 235 Z" fill="url(#gold)" opacity="0.95"/></g>
  <g transform="translate(1044,1290) rotate(180)"><path d="M-40 170 C120 40, 240 20, 420 30 L400 95 C250 85, 150 105, -20 220 Z" fill="url(#aw)"/><path d="M-40 170 C120 40, 240 20, 420 30 L412 52 C245 42, 130 58, -30 192 Z" fill="url(#gold)"/><path d="M-20 220 C150 105, 250 85, 400 95 L392 115 C250 105, 155 125, -10 235 Z" fill="url(#gold)" opacity="0.95"/></g>
  <rect x="34" y="34" width="956" height="1212" fill="none" stroke="url(#gold)" stroke-width="2" opacity="0.45" rx="18"/>
  <g transform="translate(512,150)"><circle r="58" fill="#FFFDF7" stroke="url(#gold)" stroke-width="4"/><circle r="48" fill="none" stroke="${accent}" stroke-width="1.5"/><path d="M-22 12 L-28 -12 L-10 2 L0 -20 L10 2 L28 -12 L22 12 Z" fill="url(#gold)" stroke="#8A6914" stroke-width="1.5"/><ellipse cx="0" cy="16" rx="24" ry="5" fill="none" stroke="${accent}" stroke-width="2"/></g>
  <text x="512" y="242" text-anchor="middle" font-size="24" font-family="Figtree, Arial, sans-serif" letter-spacing="5" fill="${ink}" font-weight="500">${escapeXml(org)}</text>
  <text x="512" y="292" text-anchor="middle" font-size="46" font-family="Oswald, Arial Narrow, sans-serif" letter-spacing="1" fill="${ink}" font-weight="700">${escapeXml(subtitle)}</text>
  <text x="512" y="560" text-anchor="middle" font-size="150" font-weight="900" font-family="Oswald, Arial Narrow, sans-serif" letter-spacing="4" fill="url(#aw)">${escapeXml(gratTitle(event))}</text>
  <text x="512" y="560" text-anchor="middle" font-size="150" font-weight="900" font-family="Oswald, Arial Narrow, sans-serif" letter-spacing="4" fill="none" stroke="#2E1A12" stroke-width="1.5">${escapeXml(gratTitle(event))}</text>
  <text x="700" y="620" text-anchor="middle" font-size="72" font-family="PinyonScript, cursive" fill="#8A1C1C">${escapeXml(year)}</text>
  <g transform="translate(0,720)" font-family="Figtree, Arial, sans-serif" fill="${ink}">
    <line x1="290" y1="-30" x2="290" y2="80" stroke="url(#gold)" stroke-width="2"/><line x1="470" y1="-30" x2="470" y2="80" stroke="url(#gold)" stroke-width="2"/><line x1="730" y1="-30" x2="730" y2="80" stroke="url(#gold)" stroke-width="2"/>
    <g transform="translate(155,0)" text-anchor="middle"><rect x="-18" y="-18" width="36" height="30" rx="4" fill="none" stroke="${accent}" stroke-width="2"/><line x1="-18" y1="-8" x2="18" y2="-8" stroke="${accent}" stroke-width="2"/><text y="55" font-size="28" font-weight="700">${escapeXml(dateShort)}</text></g>
    <g transform="translate(380,0)" text-anchor="middle"><circle r="18" fill="none" stroke="${accent}" stroke-width="2"/><path d="M0 -8 V2 L8 8" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round"/><text y="55" font-size="28" font-weight="700">${escapeXml(timeShort)}</text></g>
    <g transform="translate(600,0)" text-anchor="middle"><path d="M0 -20 C-12 -20 -20 -12 -20 -2 C-20 12 0 30 0 30 C0 30 20 12 20 -2 C20 -12 12 -20 0 -20 Z" fill="none" stroke="${accent}" stroke-width="2"/><circle cy="-2" r="6" fill="none" stroke="${accent}" stroke-width="2"/><text y="52" font-size="16" font-weight="600">LOCAL: ${escapeXml(local)}</text></g>
    <g transform="translate(860,10)"><text x="0" y="-30" text-anchor="middle" font-size="14" fill="${accent}" font-weight="600" letter-spacing="1">Informação</text><rect x="-52" y="-20" width="104" height="104" rx="14" fill="#FFFFFF" stroke="${accent}" stroke-width="2"/></g>
  </g>
  <g transform="translate(512,1060)"><rect x="-250" y="-55" width="500" height="110" rx="55" fill="#FFF8EE" stroke="url(#gold)" stroke-width="3"/><g transform="translate(-180,0)" fill="${accent}"><path d="M-22 -18 L-8 -28 L8 -28 L22 -18 L30 -4 L18 2 L18 30 L-18 30 L-18 2 L-30 -4 Z"/></g><text x="20" y="-10" text-anchor="middle" font-size="18" font-family="Figtree, Arial, sans-serif" fill="${muted}" letter-spacing="2">DRESS-CODE:</text><text x="20" y="28" text-anchor="middle" font-size="42" font-family="Oswald, Arial Narrow, sans-serif" fill="${ink}" font-weight="700">${escapeXml(dress)}</text></g>
  </svg>`;

  doc.addPage();
  SVGtoPDF(doc, svg, 0, 0, { width, height, preserveAspectRatio: 'xMidYMid meet' });

  if (qrUrl) {
    const qrSize = mm(22);
    const qrX = width * 0.785;
    const qrY = height * 0.575;
    await drawQrWithLogo(doc, qrX, qrY, qrSize, qrUrl, ink, accent, undefined);
  }

  doc.end();
  return done;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderInvitationPdf(
  event: EventRecord,
  invitation: Invitation,
  manifest: TemplateManifest,
  invitationUrl: string | null
): Promise<Buffer> {
  if (isGratitude(manifest)) {
    return renderGratitudePdf(event, invitation, manifest, invitationUrl);
  }
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

      const qrDestination = (manifest.pdf as any).qr_destination as string | undefined;
      const qrCustom = (manifest.pdf as any).qr_custom_url as string | undefined;
      const eventPublicUrl = (event as any).publicSlug ? links.publicEvent((event as any).publicSlug) : null;
      const qrUrl =
        qrDestination === 'custom' && qrCustom
          ? qrCustom
          : qrDestination === 'event'
            ? eventPublicUrl || invitationUrl
            : invitationUrl || eventPublicUrl;

      if (qrUrl) {
        const size = mm(36);
        const legend = (manifest.pdf as any).qr_label || 'Informação';
        if (doc.y + size + mm(18) > doc.page.height - margin) doc.addPage();
        const y = doc.y + mm(8);
        const position = manifest.pdf.qr_position;
        const x =
          position === 'bottom-center'
            ? margin + (width - size) / 2
            : position === 'bottom-left'
              ? margin
              : margin + width - size;
        await drawQrWithLogo(doc, x, y, size, qrUrl, ink, accent, legend);
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
