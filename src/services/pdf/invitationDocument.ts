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
  const guestKind = invitation.guestKind ?? null;
  const guestLabel =
    guestKind === 'couple' || guestKind === 'family'
      ? 'Convidados'
      : guestKind === 'female'
        ? 'Convidada'
        : guestKind === 'male'
          ? 'Convidado'
          : 'Convidado(a)';
  lines.push({ block: 'guest', label: guestLabel, text: invitation.guestName });
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

function gratFitTitle(text: string): Array<{ text: string; y: number; fontSize: number }> {
  const clean = (text || 'GRATITUDE').toUpperCase().trim();
  const maxWidth = 920;
  const fit = (t: string, max: number, min: number) => Math.max(min, Math.min(max, Math.floor(maxWidth / (t.length * 0.65))));
  const single = fit(clean, 220, 72);
  if (single >= 110 || clean.length <= 12) return [{ text: clean, y: 560, fontSize: single }];
  const words = clean.split(/\s+/);
  if (words.length === 1) return [{ text: clean, y: 560, fontSize: Math.max(72, single) }];
  let best: [string, string] = [clean, ''];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) { bestDiff = diff; best = [a, b]; }
  }
  const size = Math.min(fit(best[0], 170, 64), fit(best[1], 170, 64));
  return [{ text: best[0], y: 500, fontSize: size }, { text: best[1], y: 500 + size * 0.92, fontSize: size }];
}

function gratLocationLines(text: string): string[] {
  const clean = (text || 'Local a confirmar').trim();
  const max = 22;
  if (clean.length <= max) return [clean];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) cur = next;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

async function renderGratitudePdf(
  event: EventRecord,
  _invitation: Invitation,
  manifest: TemplateManifest,
  invitationUrl: string | null
): Promise<Buffer> {
  // 4:5 portrait (spec: 1 página 4:5)
  const width = 595.28;
  const height = width * 1.25;
  const doc = new PDFDocument({ size: [width, height], margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: { Title: `Convite — ${event.title}`, Author: 'Conto Contigo' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const tz = event.timezone || 'Africa/Luanda';
  const parts = (() => {
    if (!event.startsAt) return { date: '20/12', time: '14:00', year: '2026' };
    const d = new Date(event.startsAt);
    if (Number.isNaN(d.getTime())) return { date: '20/12', time: '14:00', year: '2026' };
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
      return { date: `${p['day'] ?? '20'}/${p['month'] ?? '12'}`, time: `${p['hour'] ?? '14'}:${p['minute'] ?? '00'}`, year: p['year'] ?? '2026' };
    } catch {
      const pad = (n: number) => String(n).padStart(2, '0');
      return { date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, year: String(d.getFullYear()) };
    }
  })();
  const dateShort = parts.date;
  const timeShort = parts.time;
  const year = parts.year;
  const loc = gratLocationLines(event.location?.name || event.location?.address || event.location?.onlineUrl || 'Local a confirmar');
  const org = (event.hostName || 'IGREJA CRISTÃ REINO-CHURCH').toUpperCase();
  const rawType = (event as unknown as Record<string, unknown>)['category'] ?? (event as unknown as Record<string, unknown>)['type'];
  const eventType = typeof rawType === 'string' ? rawType : 'other';
  const subtitle = (event.title || '').toUpperCase().includes('GRATITUDE')
    ? 'FESTIVAL DE ADOLESCENTES'
    : ({ wedding: 'CELEBRAÇÃO DE CASAMENTO', birthday: 'CELEBRAÇÃO DE ANIVERSÁRIO', corporate: 'EVENTO CORPORATIVO', baby: 'CELEBRAÇÃO FAMILIAR' } as Record<string, string>)[eventType] ?? 'CELEBRAÇÃO ESPECIAL';
  const title = (event.title || 'GRATITUDE').toUpperCase();
  const dress = (event.dressCode || '').toUpperCase().trim();
  const qrLabel = manifest.pdf.qr_label?.trim() || 'Informação';
  const qrDestination = manifest.pdf.qr_destination;
  const qrCustom = manifest.pdf.qr_custom_url;
  const eventPublicUrl = event.publicSlug ? links.publicEvent(event.publicSlug) : null;
  const qrUrl = qrDestination === 'custom' && qrCustom ? qrCustom : qrDestination === 'event' ? eventPublicUrl || invitationUrl : invitationUrl || eventPublicUrl;

  const titleLines = gratFitTitle(title);
  const titleTexts = titleLines.map((l) => `<text x="512" y="${l.y}" text-anchor="middle" font-size="${l.fontSize}" font-family="Anton" font-weight="400" letter-spacing="0">${escapeXml(l.text)}</text>`).join('');
  const titleStrokes = titleLines.map((l) => `<text x="512" y="${l.y}" text-anchor="middle" font-size="${l.fontSize}" font-family="Anton" font-weight="400" letter-spacing="0" fill="none" stroke="#1A1A1A" stroke-width="2" stroke-linejoin="round">${escapeXml(l.text)}</text>`).join('');
  const locTexts = loc.map((line, i) => `<text x="56" y="${42 + i * 28}" font-size="27" font-weight="700" fill="#111111">${escapeXml(line)}</text>`).join('');

  const bgTile = `<pattern id="gr-bg-tile" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="none"/><path d="M24 2 L46 24 L24 46 L2 24 Z" fill="none" stroke="#DCC9A3" stroke-width="1.2"/><path d="M24 10 L38 24 L24 38 L10 24 Z" fill="none" stroke="#DCC9A3" stroke-width="1"/><path d="M24 18 L30 24 L24 30 L18 24 Z" fill="#E8D7B5" opacity="0.7"/></pattern>`;
  const titlePattern = `<pattern id="gr-title-african" width="1200" height="420" patternUnits="userSpaceOnUse">
    <rect width="1200" height="420" fill="#E8731A"/>
    <rect x="0" y="-40" width="90" height="520" fill="#C8281E" transform="skewX(-18)"/>
    <rect x="140" y="-40" width="70" height="520" fill="#1E8A3C" transform="skewX(-18)"/>
    <rect x="260" y="-40" width="110" height="520" fill="#F2B21A" transform="skewX(-18)" opacity="0.9"/>
    <rect x="430" y="-40" width="80" height="520" fill="#C8281E" transform="skewX(-18)"/>
    <rect x="560" y="-40" width="120" height="520" fill="#1E8A3C" transform="skewX(-18)" opacity="0.92"/>
    <rect x="740" y="-40" width="90" height="520" fill="#F2B21A" transform="skewX(-18)" opacity="0.9"/>
    <rect x="890" y="-40" width="110" height="520" fill="#C8281E" transform="skewX(-18)"/>
    <rect x="1060" y="-40" width="90" height="520" fill="#1E8A3C" transform="skewX(-18)" opacity="0.92"/>
    <g stroke="#1A1A1A" stroke-width="6" fill="none"><path d="M0 70 L60 20 L120 70 L180 20 L240 70 L300 20 L360 70 L420 20 L480 70 L540 20 L600 70 L660 20 L720 70 L780 20 L840 70 L900 20 L960 70 L1020 20 L1080 70 L1140 20 L1200 70"/><path d="M0 350 L60 300 L120 350 L180 300 L240 350 L300 300 L360 350 L420 300 L480 350 L540 300 L600 350 L660 300 L720 350 L780 300 L840 350 L900 300 L960 350 L1020 300 L1080 350 L1140 300 L1200 350"/></g>
    <g transform="translate(90,210)"><path d="M0 -55 L55 45 L-55 45 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -30 L32 26 L-32 26 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -10 L14 12 L-14 12 Z" fill="#C8281E"/></g>
    <g transform="translate(300,210)"><path d="M0 -55 L55 45 L-55 45 Z" fill="#C8281E" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -30 L32 26 L-32 26 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -10 L14 12 L-14 12 Z" fill="#1E8A3C"/></g>
    <g transform="translate(520,210)"><path d="M0 -55 L55 45 L-55 45 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -30 L32 26 L-32 26 Z" fill="#E8731A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -10 L14 12 L-14 12 Z" fill="#F2B21A"/></g>
    <g transform="translate(760,210)"><path d="M0 -55 L55 45 L-55 45 Z" fill="#C8281E" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -30 L32 26 L-32 26 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -10 L14 12 L-14 12 Z" fill="#1E8A3C"/></g>
    <g transform="translate(990,210)"><path d="M0 -55 L55 45 L-55 45 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -30 L32 26 L-32 26 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -10 L14 12 L-14 12 Z" fill="#C8281E"/></g>
    <g transform="translate(180,210)"><path d="M0 -48 L48 0 L0 48 L-48 0 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -28 L28 0 L0 28 L-28 0 Z" fill="#C8281E" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill="#1E8A3C"/></g>
    <g transform="translate(410,210)"><path d="M0 -48 L48 0 L0 48 L-48 0 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -28 L28 0 L0 28 L-28 0 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill="#C8281E"/></g>
    <g transform="translate(640,210)"><path d="M0 -48 L48 0 L0 48 L-48 0 Z" fill="#C8281E" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -28 L28 0 L0 28 L-28 0 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill="#F2B21A"/></g>
    <g transform="translate(880,210)"><path d="M0 -48 L48 0 L0 48 L-48 0 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="3"/><path d="M0 -28 L28 0 L0 28 L-28 0 Z" fill="#E8731A" stroke="#1A1A1A" stroke-width="2"/><path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill="#1A1A1A"/></g>
    <path d="M0 150 L30 130 L60 150 L90 130 L120 150 L150 130 L180 150 L210 130 L240 150 L270 130 L300 150 L330 130 L360 150 L390 130 L420 150 L450 130 L480 150 L510 130 L540 150 L570 130 L600 150 L630 130 L660 150 L690 130 L720 150 L750 130 L780 150 L810 130 L840 150 L870 130 L900 150 L930 130 L960 150 L990 130 L1020 150 L1050 130 L1080 150 L1110 130 L1140 150 L1170 130 L1200 150 L1200 170 L1170 150 L1140 170 L1110 150 L1080 170 L1050 150 L1020 170 L990 150 L960 170 L930 150 L900 170 L870 150 L840 170 L810 150 L780 170 L750 150 L720 170 L690 150 L660 170 L630 150 L600 170 L570 150 L540 170 L510 150 L480 170 L450 150 L420 170 L390 150 L360 170 L330 150 L300 170 L270 150 L240 170 L210 150 L180 170 L150 150 L120 170 L90 150 L60 170 L30 150 L0 170 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="2"/>
    <path d="M0 210 L30 190 L60 210 L90 190 L120 210 L150 190 L180 210 L210 190 L240 210 L270 190 L300 210 L330 190 L360 210 L390 190 L420 210 L450 190 L480 210 L510 190 L540 210 L570 190 L600 210 L630 190 L660 210 L690 190 L720 210 L750 190 L780 210 L810 190 L840 210 L870 190 L900 210 L930 190 L960 210 L990 190 L1020 210 L1050 190 L1080 210 L1110 190 L1140 210 L1170 190 L1200 210 L1200 230 L1170 210 L1140 230 L1110 210 L1080 230 L1050 210 L1020 230 L990 210 L960 230 L930 210 L900 230 L870 210 L840 230 L810 210 L780 230 L750 210 L720 230 L690 210 L660 230 L630 210 L600 230 L570 210 L540 230 L510 210 L480 230 L450 210 L420 230 L390 210 L360 230 L330 210 L300 230 L270 210 L240 230 L210 210 L180 230 L150 210 L120 230 L90 210 L60 230 L30 210 L0 230 Z" fill="#C8281E" stroke="#1A1A1A" stroke-width="2"/>
  </pattern>`;
  const ribbonPattern = `<pattern id="gr-ribbon-african" width="44" height="44" patternUnits="userSpaceOnUse"><rect width="44" height="44" fill="#C8281E"/><path d="M22 0 L44 22 L22 44 L0 22 Z" fill="#1E8A3C" stroke="#1A1A1A" stroke-width="1.5"/><path d="M22 8 L36 22 L22 36 L8 22 Z" fill="#F2B21A" stroke="#1A1A1A" stroke-width="1"/><path d="M22 15 L29 22 L22 29 L15 22 Z" fill="#E8731A"/><path d="M0 22 L22 0 M22 44 L44 22" stroke="#1A1A1A" stroke-width="1.5" opacity="0.45"/></pattern>`;

  const dressBlock = dress ? `
    <g data-testid="gratitude-dresscode">
      <rect x="266" y="1063" width="492" height="115" rx="57.5" fill="#FFF3DC" stroke="#D4A017" stroke-width="3"/>
      <g transform="translate(322,1120)" fill="#D49A1A"><path d="M-30 -24 L-11 -38 L11 -38 L30 -24 L42 -6 L26 2 L26 40 L-26 40 L-26 2 L-42 -6 Z"/></g>
      <text x="540" y="1100" text-anchor="middle" font-size="20" font-family="Figtree" font-weight="700" fill="#111111" letter-spacing="1">DRESS-CODE:</text>
      <text x="540" y="1142" text-anchor="middle" font-size="50" font-family="Oswald-Bold" font-weight="700" fill="#111111">${escapeXml(dress)}</text>
    </g>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1280" width="1024" height="1280">
  <defs>
    <radialGradient id="gr-glow" cx="50%" cy="42%" r="58%"><stop offset="0%" stop-color="#FFFDF8"/><stop offset="100%" stop-color="#FFF6EA" stop-opacity="0"/></radialGradient>
    <linearGradient id="gr-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8C6A1F"/><stop offset="35%" stop-color="#F3D580"/><stop offset="65%" stop-color="#F7E39A"/><stop offset="100%" stop-color="#B8862B"/></linearGradient>
    <linearGradient id="gr-gold-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFF4BF" stop-opacity="0.95"/><stop offset="45%" stop-color="#D4A017" stop-opacity="0.9"/><stop offset="100%" stop-color="#8C6A1F" stop-opacity="0.95"/></linearGradient>
    ${bgTile}${titlePattern}${ribbonPattern}
    <linearGradient id="gr-fade-tr" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="white" stop-opacity="0"/><stop offset="55%" stop-color="white" stop-opacity="0.65"/><stop offset="100%" stop-color="white" stop-opacity="1"/></linearGradient>
    <linearGradient id="gr-fade-bl" x1="1" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="white" stop-opacity="0"/><stop offset="55%" stop-color="white" stop-opacity="0.65"/><stop offset="100%" stop-color="white" stop-opacity="1"/></linearGradient>
    <mask id="gr-mask-tr"><rect x="560" y="0" width="464" height="420" fill="url(#gr-fade-tr)"/></mask>
    <mask id="gr-mask-bl"><rect x="0" y="860" width="464" height="420" fill="url(#gr-fade-bl)"/></mask>
    <clipPath id="gr-ribbon-top-clip"><path d="M-30 185 C 110 40, 250 15, 430 30 C 455 32, 455 32, 440 70 C 270 55, 140 85, 10 215 C -10 235, -30 220, -30 185 Z"/></clipPath>
    <clipPath id="gr-ribbon-bottom-clip"><path d="M570 1265 C 650 1110, 760 1020, 1055 990 C 1075 987, 1085 995, 1080 1025 C 820 1055, 720 1135, 640 1285 C 625 1305, 590 1295, 570 1265 Z"/></clipPath>
    <clipPath id="gr-title-clip">${titleTexts}</clipPath>
  </defs>
  <rect width="1024" height="1280" fill="#FFF6EA"/><rect width="1024" height="1280" fill="url(#gr-glow)"/>
  <g fill="none" stroke="#EADFC8" stroke-width="1.2" opacity="0.35"><circle cx="512" cy="560" r="250"/><circle cx="512" cy="560" r="330"/><circle cx="512" cy="560" r="410"/></g>
  <g opacity="0.13"><rect x="600" y="-20" width="460" height="440" fill="url(#gr-bg-tile)" mask="url(#gr-mask-tr)"/><rect x="-30" y="860" width="460" height="440" fill="url(#gr-bg-tile)" mask="url(#gr-mask-bl)"/></g>
  <g clip-path="url(#gr-ribbon-top-clip)"><rect x="-60" y="-20" width="560" height="320" fill="url(#gr-ribbon-african)"/><path d="M-30 185 C 110 40, 250 15, 430 30 L 440 70 C 270 55, 140 85, 10 215 Z" fill="url(#gr-gold-shine)" opacity="0.28"/><path d="M-30 185 C 110 40, 250 15, 430 30 C 438 31, 442 38, 440 46 C 270 31, 130 60, -10 200 C -18 210, -30 200, -30 185 Z" fill="url(#gr-gold)"/><path d="M10 215 C 140 85, 270 55, 440 70 C 448 71, 450 78, 446 86 C 275 71, 150 101, 30 225 C 22 233, 10 225, 10 215 Z" fill="url(#gr-gold)" opacity="0.95"/></g>
  <g clip-path="url(#gr-ribbon-bottom-clip)"><rect x="520" y="940" width="560" height="380" fill="url(#gr-ribbon-african)"/><path d="M570 1265 C 650 1110, 760 1020, 1055 990 L 1080 1025 C 820 1055, 720 1135, 640 1285 Z" fill="url(#gr-gold-shine)" opacity="0.28"/><path d="M570 1265 C 650 1110, 760 1020, 1055 990 C 1065 988, 1072 994, 1070 1002 C 800 1032, 700 1115, 620 1272 C 612 1284, 580 1280, 570 1265 Z" fill="url(#gr-gold)"/><path d="M640 1285 C 720 1135, 820 1055, 1080 1025 C 1088 1024, 1092 1031, 1088 1040 C 830 1068, 740 1148, 660 1292 C 654 1300, 644 1295, 640 1285 Z" fill="url(#gr-gold)" opacity="0.95"/></g>
  <text x="512" y="262" text-anchor="middle" font-size="31" font-family="Figtree" font-weight="500" letter-spacing="7.7" fill="#222222">${escapeXml(org)}</text>
  <text x="512" y="325" text-anchor="middle" font-size="49" font-family="Figtree" font-weight="700" letter-spacing="0.5" fill="#111111">${escapeXml(subtitle)}</text>
  <g><g clip-path="url(#gr-title-clip)"><rect x="0" y="300" width="1024" height="360" fill="url(#gr-title-african)"/></g>${titleStrokes}</g>
  <text text-anchor="middle" font-size="90" font-family="CormorantGaramond-Bold" font-weight="700" fill="#B3121A" transform="translate(512,678) skewX(-10)"><tspan x="0" y="0">${escapeXml(year)}</tspan></text>
  <g font-family="Figtree" fill="#111111">
    <line x1="276" y1="846" x2="276" y2="936" stroke="#D4A017" stroke-width="2"/><line x1="430" y1="846" x2="430" y2="936" stroke="#D4A017" stroke-width="2"/><line x1="730" y1="846" x2="730" y2="936" stroke="#D4A017" stroke-width="2"/>
    <g transform="translate(72,872)"><rect x="0" y="0" width="44" height="38" rx="5" fill="none" stroke="#111111" stroke-width="3"/><line x1="0" y1="12" x2="44" y2="12" stroke="#111111" stroke-width="3"/><line x1="12" y1="-5" x2="12" y2="6" stroke="#111111" stroke-width="3" stroke-linecap="round"/><line x1="32" y1="-5" x2="32" y2="6" stroke="#111111" stroke-width="3" stroke-linecap="round"/><text x="58" y="30" font-size="44" font-weight="500" fill="#111111">${escapeXml(dateShort)}</text></g>
    <g transform="translate(318,870)"><circle cx="22" cy="22" r="22" fill="none" stroke="#111111" stroke-width="3"/><path d="M22 10 V24 L33 32" fill="none" stroke="#111111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="56" y="32" font-size="44" font-weight="500" fill="#111111">${escapeXml(timeShort)}</text></g>
    <g transform="translate(468,862)"><path d="M22 0 C10 0 0 10 0 22 C0 40 22 62 22 62 C22 62 44 40 44 22 C44 10 34 0 22 0 Z" fill="none" stroke="#111111" stroke-width="3"/><circle cx="22" cy="22" r="8" fill="none" stroke="#111111" stroke-width="3"/><text x="56" y="18" font-size="20" font-weight="700" fill="#111111">LOCAL:</text>${locTexts}</g>
    <g><text x="877" y="842" text-anchor="middle" font-size="24" font-weight="700" fill="#111111">${escapeXml(qrLabel)}</text><rect x="812" y="852" width="130" height="130" rx="14" fill="#FFFFFF" stroke="#D4A017" stroke-width="3"/></g>
  </g>
  ${dressBlock}
  </svg>`;

  SVGtoPDF(doc, svg, 0, 0, { width, height, preserveAspectRatio: 'xMidYMid meet' });

  if (qrUrl) {
    // Cartão QR no SVG: x=812 y=852 w=130 h=130 (canvas 1024x1280) => 12.7% largura
    const qrSize = width * (130 / 1024);
    const qrX = width * (812 / 1024);
    const qrY = height * (852 / 1280);
    await drawQrWithLogo(doc, qrX, qrY, qrSize, qrUrl, '#111111', '#D4A017', undefined);
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

      const qrDestination = manifest.pdf.qr_destination;
      const qrCustom = manifest.pdf.qr_custom_url;
      const eventPublicUrl = event.publicSlug ? links.publicEvent(event.publicSlug) : null;
      const qrUrl =
        qrDestination === 'custom' && qrCustom
          ? qrCustom
          : qrDestination === 'event'
            ? eventPublicUrl || invitationUrl
            : invitationUrl || eventPublicUrl;

      if (qrUrl) {
        const size = mm(36);
        const legend = manifest.pdf.qr_label || 'Informação';
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
