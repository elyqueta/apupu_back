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

const WHATSAPP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#1e8a3c"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.2 13.6c-.2.6-1.3 1.1-1.8 1.2-.5 0-1 .3-3.3-.7-2.8-1.2-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.2 1.300 2.500 1.500.3.1.5.1.7-.1l.9-1.100c.2-.3.4-.2.7-.1l1.900.9c.3.1.5.2.6.3.1.2.1.8-.1 1.400Z"/></svg>`;

/** QR estilizado (Bloco 15): cartão arredondado, borda fina, logo central, H ECC, legenda. */
async function drawQrWithLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number,
  url: string,
  color: string,
  accent: string,
  legend?: string,
  icon: 'none' | 'whatsapp' | 'brand' = 'brand'
): Promise<void> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark: color, light: '#0000' },
  });
  // Cantos ligeiramente arredondados nos módulos (substitui <rect .../> por rx/ry pequenos).
  const roundedSvg = svg.replace(/<rect([^>]*?)\/>/g, (m, attrs: string) => {
    if (/rx=/.test(attrs)) return m;
    return `<rect${attrs} rx="0.8" ry="0.8"/>`;
  });

  const quiet = Math.max(mm(2.4), size * 0.08);
  const cardR = Math.max(mm(2), size * 0.08);
  const qrSize = Math.max(1, size - quiet * 2);
  // Força tamanho explícito no SVG raiz para evitar renderização em tamanho natural.
  const scalableSvg = roundedSvg
    .replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
      const cleaned = attrs
        .replace(/\swidth="[^"]*"/g, '')
        .replace(/\sheight="[^"]*"/g, '');
      return `<svg${cleaned} width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet">`;
    });

  doc.save();
  // Cartão branco com borda fina dourada/cor do template.
  doc.lineWidth(Math.max(0.6, size * 0.018)).strokeColor(accent);
  doc.roundedRect(x, y, size, size, cardR).fillAndStroke('#FFFFFF', accent);

  SVGtoPDF(doc, scalableSvg, x + quiet, y + quiet, { width: qrSize, height: qrSize, assumePt: true } as any);

  if (icon !== 'none') {
    const logo = qrSize * 0.22;
    const lx = x + (size - logo) / 2;
    const ly = y + (size - logo) / 2;
    doc.roundedRect(lx - 2, ly - 2, logo + 4, logo + 4, 3).fill('#FFFFFF');
    const iconSvg = icon === 'whatsapp' ? WHATSAPP_SVG : symbolSvg();
    try {
      SVGtoPDF(doc, iconSvg, lx + logo * 0.12, ly + logo * 0.12, { width: logo * 0.76, height: logo * 0.76, assumePt: true } as any);
    } catch {
      // ignore icon rendering failure
    }
  }

  if (legend) {
    doc.font(resolveCatalogFont('sans', 'regular')).fontSize(7).fillColor(accent);
    doc.text(legend.toUpperCase(), x, y - mm(4), { width: size, align: 'center', characterSpacing: 0.8 });
  }
  doc.restore();
}

function isGratitude(manifest: TemplateManifest): boolean {
  return manifest.ornaments.frame === 'gratitude' || manifest.ornaments.corners === 'gratitude' || (manifest as any).templateSlug === 'gratitude';
}

interface GratitudeQrConfig {
  url: string | null;
  label: string;
  icon: 'none' | 'whatsapp' | 'brand';
  size: 'md' | 'lg';
  imageUrl: string | null;
}

function normalizeQrPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

function resolveQrConfig(manifest: TemplateManifest, invitationUrl: string | null, eventPublicUrl: string | null): GratitudeQrConfig {
  const pdf = manifest.pdf as any;
  const label = String(pdf.qr_label || 'Informação').trim() || 'Informação';
  const icon = (pdf.qr_icon === 'none' || pdf.qr_icon === 'whatsapp' || pdf.qr_icon === 'brand') ? pdf.qr_icon : 'brand';
  const size = pdf.qr_size === 'lg' ? 'lg' : 'md';
  const mode = pdf.qr_mode || pdf.qr_destination || 'invite';

  if (mode === 'image') {
    const imageUrl = typeof pdf.qr_image_url === 'string' && pdf.qr_image_url.trim() ? pdf.qr_image_url.trim() : null;
    return { url: null, label, icon: 'none', size, imageUrl };
  }

  let url: string | null = null;
  if (mode === 'whatsapp') {
    const phone = normalizeQrPhone(String(pdf.qr_whatsapp_phone || ''));
    if (phone) {
      const text = String(pdf.qr_whatsapp_message || '').trim();
      url = `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    }
  } else if (mode === 'custom') {
    const custom = String(pdf.qr_custom_url || '').trim();
    if (/^https?:\/\//i.test(custom)) url = custom;
  } else if (mode === 'event') {
    url = eventPublicUrl || invitationUrl;
  } else {
    url = invitationUrl || eventPublicUrl;
  }

  return { url, label, icon, size, imageUrl: null };
}

function gratLocationLines(text: string, max = 28): string[] {
  const clean = (text || 'Local a confirmar').trim();
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
  return lines.slice(0, 3);
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

async function renderGratitudePdf(
  event: EventRecord,
  _invitation: Invitation,
  manifest: TemplateManifest,
  invitationUrl: string | null
): Promise<Buffer> {
  const W = 1024;
  const H = 1280;
  const width = 595.28;
  const height = width * 1.25; // 4:5
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

  const org = (event.hostName || 'IGREJA CRISTÃ REINO-CHURCH').toUpperCase();
  const rawType = (event as unknown as Record<string, unknown>)['category'] ?? (event as unknown as Record<string, unknown>)['type'];
  const eventType = typeof rawType === 'string' ? rawType : 'other';
  const subtitle = (event.title || '').toUpperCase().includes('GRATITUDE')
    ? 'FESTIVAL DE ADOLESCENTES'
    : ({ wedding: 'CELEBRAÇÃO DE CASAMENTO', birthday: 'CELEBRAÇÃO DE ANIVERSÁRIO', corporate: 'EVENTO CORPORATIVO', baby: 'CELEBRAÇÃO FAMILIAR' } as Record<string, string>)[eventType] ?? 'CELEBRAÇÃO ESPECIAL';
  const title = (event.title || 'GRATITUDE').toUpperCase();
  const dress = (event.dressCode || '').toUpperCase().trim();
  const eventPublicUrl = event.publicSlug ? links.publicEvent(event.publicSlug) : null;
  const qrConfig = resolveQrConfig(manifest, invitationUrl, eventPublicUrl);
  const logoUrl = String((manifest.pdf as any).logo_url || '').trim();
  const logoShape = (manifest.pdf as any).logo_shape === 'original' ? 'original' : 'circle';
  const logoSizeKey = (manifest.pdf as any).logo_size === 'sm' ? 'sm' : (manifest.pdf as any).logo_size === 'lg' ? 'lg' : 'md';
  const logoPx = { sm: W * 0.14, md: W * 0.19, lg: W * 0.23 }[logoSizeKey];
  const hasLogo = Boolean(logoUrl);

  // Vertical layout in canvas percentages (user spec)
  const orgY = H * 0.194;
  const subY = H * 0.224;
  const titleTop = H * 0.286;
  const titleBottom = H * 0.493;
  const titleH = titleBottom - titleTop; // 20.7%
  const yearY = H * 0.498;
  const infoY = H * 0.629;
  const dressY = H * 0.787;

  // Close space when no logo: shift content up slightly
  const shiftUp = hasLogo ? 0 : H * 0.055;
  const orgYp = orgY - shiftUp;
  const subYp = subY - shiftUp;
  const titleTopP = titleTop - shiftUp;
  const yearYp = yearY - shiftUp;
  const infoYp = dress ? infoY - shiftUp : infoY - shiftUp + H * 0.02;

  const loc = gratLocationLines(event.location?.name || event.location?.address || event.location?.onlineUrl || 'Local a confirmar', 26);
  const locTspans = loc.map((line, i) => `<tspan x="0" dy="${i === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`).join('');

  const afro = `<pattern id="afro" width="240" height="240" patternUnits="userSpaceOnUse" patternTransform="rotate(-32) scale(1.15)">
<g transform="translate(0,0)"><rect width="240" height="30" fill="#c8281e"/><polyline points="0,4 15,26 30,4 45,26 60,4 75,26 90,4 105,26 120,4 135,26 150,4 165,26 180,4 195,26 210,4 225,26 240,4" fill="none" stroke="#f2b21a" stroke-width="5" stroke-linejoin="miter"/></g>
<g transform="translate(0,30)"><rect width="240" height="30" fill="#1e8a3c"/><path d="M3 27 15 4 27 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M33 27 45 4 57 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M63 27 75 4 87 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M93 27 105 4 117 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M123 27 135 4 147 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M153 27 165 4 177 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M183 27 195 4 207 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M213 27 225 4 237 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/></g>
<g transform="translate(0,60)"><rect width="240" height="30" fill="#f2b21a"/><path d="M2 22 15 8 28 22M2 14 15 1 28 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M32 22 45 8 58 22M32 14 45 1 58 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M62 22 75 8 88 22M62 14 75 1 88 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M92 22 105 8 118 22M92 14 105 1 118 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M122 22 135 8 148 22M122 14 135 1 148 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M152 22 165 8 178 22M152 14 165 1 178 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M182 22 195 8 208 22M182 14 195 1 208 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M212 22 225 8 238 22M212 14 225 1 238 14" fill="none" stroke="#161616" stroke-width="4"/></g>
<g transform="translate(0,90)"><rect width="240" height="30" fill="#e8731a"/><path d="M15 3 27 15 15 27 3 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="15" cy="15" r="3" fill="#f2b21a"/><path d="M45 3 57 15 45 27 33 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="45" cy="15" r="3" fill="#f2b21a"/><path d="M75 3 87 15 75 27 63 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="75" cy="15" r="3" fill="#f2b21a"/><path d="M105 3 117 15 105 27 93 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="105" cy="15" r="3" fill="#f2b21a"/><path d="M135 3 147 15 135 27 123 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="135" cy="15" r="3" fill="#f2b21a"/><path d="M165 3 177 15 165 27 153 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="165" cy="15" r="3" fill="#f2b21a"/><path d="M195 3 207 15 195 27 183 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="195" cy="15" r="3" fill="#f2b21a"/><path d="M225 3 237 15 225 27 213 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="225" cy="15" r="3" fill="#f2b21a"/></g>
<g transform="translate(0,120)"><rect width="240" height="30" fill="#f2b21a"/><circle cx="15" cy="15" r="5" fill="#f2b21a"/><circle cx="45" cy="15" r="5" fill="#c8281e"/><circle cx="75" cy="15" r="5" fill="#f2b21a"/><circle cx="105" cy="15" r="5" fill="#c8281e"/><circle cx="135" cy="15" r="5" fill="#f2b21a"/><circle cx="165" cy="15" r="5" fill="#c8281e"/><circle cx="195" cy="15" r="5" fill="#f2b21a"/><circle cx="225" cy="15" r="5" fill="#c8281e"/></g>
<g transform="translate(0,150)"><rect width="240" height="30" fill="#f2b21a"/><polyline points="0,4 15,26 30,4 45,26 60,4 75,26 90,4 105,26 120,4 135,26 150,4 165,26 180,4 195,26 210,4 225,26 240,4" fill="none" stroke="#c8281e" stroke-width="6" stroke-linejoin="miter"/></g>
<g transform="translate(0,180)"><rect width="240" height="30" fill="#1e8a3c"/><path d="M2 22 15 8 28 22M2 14 15 1 28 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M32 22 45 8 58 22M32 14 45 1 58 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M62 22 75 8 88 22M62 14 75 1 88 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M92 22 105 8 118 22M92 14 105 1 118 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M122 22 135 8 148 22M122 14 135 1 148 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M152 22 165 8 178 22M152 14 165 1 178 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M182 22 195 8 208 22M182 14 195 1 208 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M212 22 225 8 238 22M212 14 225 1 238 14" fill="none" stroke="#f2b21a" stroke-width="4"/></g>
<g transform="translate(0,210)"><rect width="240" height="30" fill="#c8281e"/><path d="M3 3 15 26 27 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M33 3 45 26 57 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M63 3 75 26 87 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M93 3 105 26 117 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M123 3 135 26 147 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M153 3 165 26 177 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M183 3 195 26 207 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M213 3 225 26 237 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/></g>
<path d="M0 0H240" stroke="#161616" stroke-width="2"/><path d="M0 30H240" stroke="#161616" stroke-width="2"/><path d="M0 60H240" stroke="#161616" stroke-width="2"/><path d="M0 90H240" stroke="#161616" stroke-width="2"/><path d="M0 120H240" stroke="#161616" stroke-width="2"/><path d="M0 150H240" stroke="#161616" stroke-width="2"/><path d="M0 180H240" stroke="#161616" stroke-width="2"/><path d="M0 210H240" stroke="#161616" stroke-width="2"/><path d="M0 240H240" stroke="#161616" stroke-width="2"/>
</pattern>`;

  const qrCardSize = qrConfig.size === 'lg' ? W * 0.155 : W * 0.14;
  const qrCardX = W - W * 0.05 - qrCardSize;
  const qrCardY = infoYp - qrCardSize * 0.55;
  const qrPad = qrCardSize * 0.08;
  const qrInner = qrCardSize - qrPad * 2;
  const infoRightLimit = qrCardX - W * 0.03;

  // Info line columns: date, time, location, qr
  const col1X = W * 0.06;
  const col2X = W * 0.29;
  const col3X = W * 0.455;
  const sepY1 = infoYp - H * 0.035;
  const sepY2 = infoYp + H * 0.035;
  const sep1X = col2X - W * 0.018;
  const sep2X = col3X - W * 0.022;
  const sep3X = infoRightLimit - W * 0.01;

  const dressBlock = dress ? `
    <g data-testid="gratitude-dresscode">
      <rect x="${W * 0.266}" y="${dressY - H * 0.04}" width="${W * 0.468}" height="${H * 0.09}" rx="${H * 0.045}" fill="#FFF3DC" stroke="#D4A017" stroke-width="3"/>
      <g transform="translate(${W * 0.324},${dressY + H * 0.005})" fill="#D49A1A"><path d="M-30 -24 L-11 -38 L11 -38 L30 -24 L42 -6 L26 2 L26 40 L-26 40 L-26 2 L-42 -6 Z"/><path d="M-11 -38 C-6 -30 6 -30 11 -38" fill="none" stroke="#B27A0E" stroke-width="2"/></g>
      <text x="${W * 0.535}" y="${dressY - H * 0.012}" text-anchor="middle" font-size="20" font-family="Montserrat-Bold" font-weight="700" fill="#111111" letter-spacing="1">DRESS-CODE:</text>
      <text x="${W * 0.535}" y="${dressY + H * 0.026}" text-anchor="middle" font-size="48" font-family="Anton" font-weight="400" fill="#111111">${escapeXml(dress)}</text>
    </g>` : '';

  const logoCenterY = H * 0.119 - shiftUp;
  const logoBlock = hasLogo
    ? `<g data-testid="gratitude-logo"><defs><clipPath id="logoClip"><${logoShape === 'circle' ? `circle cx="${W / 2}" cy="${logoCenterY}" r="${logoPx / 2}"` : `rect x="${(W - logoPx) / 2}" y="${logoCenterY - logoPx / 2}" width="${logoPx}" height="${logoPx}" rx="12"`}/></clipPath></defs><image href="${escapeXml(logoUrl)}" x="${(W - logoPx) / 2}" y="${logoCenterY - logoPx / 2}" width="${logoPx}" height="${logoPx}" preserveAspectRatio="xMidYMid slice" clip-path="url(#logoClip)"/>${logoShape === 'circle' ? `<circle cx="${W / 2}" cy="${logoCenterY}" r="${logoPx / 2}" fill="none" stroke="#D4A017" stroke-width="4"/>` : ''}</g>`
    : '';

  const qrCardBlock = (qrConfig.url || qrConfig.imageUrl)
    ? `<g data-testid="gratitude-qr">
        <text x="${qrCardX + qrCardSize / 2}" y="${qrCardY - 10}" text-anchor="middle" font-size="24" font-family="Montserrat-Bold" font-weight="700" fill="#111111">${escapeXml(qrConfig.label)}</text>
        <rect x="${qrCardX}" y="${qrCardY}" width="${qrCardSize}" height="${qrCardSize}" rx="12" fill="#FFFFFF" stroke="#D4A017" stroke-width="3"/>
      </g>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8c6a1f"/><stop offset=".35" stop-color="#f3d580"/><stop offset=".65" stop-color="#b8862b"/><stop offset="1" stop-color="#f7e3a0"/></linearGradient>
    <pattern id="geo" width="90" height="90" patternUnits="userSpaceOnUse"><path d="M45 6 84 45 45 84 6 45Z M45 24 66 45 45 66 24 45Z M0 0 45 45 90 0M0 90 45 45 90 90" fill="none" stroke="#e9d3a6" stroke-width="5"/></pattern>
    <radialGradient id="rTR" gradientUnits="userSpaceOnUse" cx="${W}" cy="0" r="460"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#000"/></radialGradient>
    <radialGradient id="rBL" gradientUnits="userSpaceOnUse" cx="0" cy="${H}" r="460"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#000"/></radialGradient>
    <mask id="mTR"><rect width="${W}" height="${H}" fill="url(#rTR)"/></mask>
    <mask id="mBL"><rect width="${W}" height="${H}" fill="url(#rBL)"/></mask>
    <pattern id="rib" width="240" height="240" patternUnits="userSpaceOnUse" patternTransform="rotate(-30) scale(.9)">
      <g transform="translate(0,0)"><rect width="240" height="30" fill="#c8281e"/><polyline points="0,4 15,26 30,4 45,26 60,4 75,26 90,4 105,26 120,4 135,26 150,4 165,26 180,4 195,26 210,4 225,26 240,4" fill="none" stroke="#f2b21a" stroke-width="5"/></g>
      <g transform="translate(0,30)"><rect width="240" height="30" fill="#1e8a3c"/><path d="M3 27 15 4 27 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M33 27 45 4 57 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M63 27 75 4 87 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M93 27 105 4 117 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M123 27 135 4 147 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M153 27 165 4 177 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M183 27 195 4 207 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/><path d="M213 27 225 4 237 27Z" fill="#e8731a" stroke="#161616" stroke-width="2.4"/></g>
      <g transform="translate(0,60)"><rect width="240" height="30" fill="#9a1d15"/><path d="M2 22 15 8 28 22M2 14 15 1 28 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M32 22 45 8 58 22M32 14 45 1 58 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M62 22 75 8 88 22M62 14 75 1 88 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M92 22 105 8 118 22M92 14 105 1 118 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M122 22 135 8 148 22M122 14 135 1 148 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M152 22 165 8 178 22M152 14 165 1 178 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M182 22 195 8 208 22M182 14 195 1 208 14" fill="none" stroke="#161616" stroke-width="4"/><path d="M212 22 225 8 238 22M212 14 225 1 238 14" fill="none" stroke="#161616" stroke-width="4"/></g>
      <g transform="translate(0,90)"><rect width="240" height="30" fill="#161616"/><path d="M15 3 27 15 15 27 3 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="15" cy="15" r="3" fill="#f2b21a"/><path d="M45 3 57 15 45 27 33 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="45" cy="15" r="3" fill="#f2b21a"/><path d="M75 3 87 15 75 27 63 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="75" cy="15" r="3" fill="#f2b21a"/><path d="M105 3 117 15 105 27 93 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="105" cy="15" r="3" fill="#f2b21a"/><path d="M135 3 147 15 135 27 123 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="135" cy="15" r="3" fill="#f2b21a"/><path d="M165 3 177 15 165 27 153 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="165" cy="15" r="3" fill="#f2b21a"/><path d="M195 3 207 15 195 27 183 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="195" cy="15" r="3" fill="#f2b21a"/><path d="M225 3 237 15 225 27 213 15Z" fill="#1e8a3c" stroke="#161616" stroke-width="2.4"/><circle cx="225" cy="15" r="3" fill="#f2b21a"/></g>
      <g transform="translate(0,120)"><rect width="240" height="30" fill="#9a1d15"/><circle cx="15" cy="15" r="5" fill="#f2b21a"/><circle cx="45" cy="15" r="5" fill="#c8281e"/><circle cx="75" cy="15" r="5" fill="#f2b21a"/><circle cx="105" cy="15" r="5" fill="#c8281e"/><circle cx="135" cy="15" r="5" fill="#f2b21a"/><circle cx="165" cy="15" r="5" fill="#c8281e"/><circle cx="195" cy="15" r="5" fill="#f2b21a"/><circle cx="225" cy="15" r="5" fill="#c8281e"/></g>
      <g transform="translate(0,150)"><rect width="240" height="30" fill="#9a1d15"/><polyline points="0,4 15,26 30,4 45,26 60,4 75,26 90,4 105,26 120,4 135,26 150,4 165,26 180,4 195,26 210,4 225,26 240,4" fill="none" stroke="#f2b21a" stroke-width="6"/></g>
      <g transform="translate(0,180)"><rect width="240" height="30" fill="#1e8a3c"/><path d="M2 22 15 8 28 22M2 14 15 1 28 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M32 22 45 8 58 22M32 14 45 1 58 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M62 22 75 8 88 22M62 14 75 1 88 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M92 22 105 8 118 22M92 14 105 1 118 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M122 22 135 8 148 22M122 14 135 1 148 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M152 22 165 8 178 22M152 14 165 1 178 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M182 22 195 8 208 22M182 14 195 1 208 14" fill="none" stroke="#f2b21a" stroke-width="4"/><path d="M212 22 225 8 238 22M212 14 225 1 238 14" fill="none" stroke="#f2b21a" stroke-width="4"/></g>
      <g transform="translate(0,210)"><rect width="240" height="30" fill="#c8281e"/><path d="M3 3 15 26 27 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M33 3 45 26 57 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M63 3 75 26 87 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M93 3 105 26 117 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M123 3 135 26 147 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M153 3 165 26 177 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M183 3 195 26 207 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/><path d="M213 3 225 26 237 3Z" fill="#f2b21a" stroke="#161616" stroke-width="2.4"/></g>
      <path d="M0 0H240" stroke="#161616" stroke-width="2"/><path d="M0 30H240" stroke="#161616" stroke-width="2"/><path d="M0 60H240" stroke="#161616" stroke-width="2"/><path d="M0 90H240" stroke="#161616" stroke-width="2"/><path d="M0 120H240" stroke="#161616" stroke-width="2"/><path d="M0 150H240" stroke="#161616" stroke-width="2"/><path d="M0 180H240" stroke="#161616" stroke-width="2"/><path d="M0 210H240" stroke="#161616" stroke-width="2"/><path d="M0 240H240" stroke="#161616" stroke-width="2"/>
    </pattern>
    ${afro}
  </defs>
  <rect width="${W}" height="${H}" fill="#FFF6EA"/>
  <rect width="${W}" height="${H}" fill="url(#geo)" mask="url(#mTR)" opacity=".4"/>
  <rect width="${W}" height="${H}" fill="url(#geo)" mask="url(#mBL)" opacity=".4"/>
  <path d="M0 0H440C330 78 190 160 0 236Z" fill="url(#rib)"/>
  <path d="M440 0C330 78 190 160 0 236" fill="none" stroke="url(#gold)" stroke-width="26"/>
  <path d="M410 0C305 74 178 150 0 220" fill="none" stroke="#fff3c4" stroke-opacity=".85" stroke-width="4"/>
  <path d="M1024 1280H540C700 1215 900 1110 1024 1000Z" fill="url(#rib)"/>
  <path d="M540 1280C700 1215 900 1110 1024 1000" fill="none" stroke="url(#gold)" stroke-width="30"/>
  <path d="M580 1280C735 1222 915 1125 1024 1030" fill="none" stroke="#fff3c4" stroke-opacity=".85" stroke-width="4"/>

  ${logoBlock}

  <text x="${W / 2}" y="${orgYp}" text-anchor="middle" font-size="31" font-family="Montserrat-Medium" font-weight="500" letter-spacing="7.7" fill="#1B1B1B">${escapeXml(org)}</text>
  <text x="${W / 2}" y="${subYp}" text-anchor="middle" font-size="49" font-family="Montserrat-Bold" font-weight="700" fill="#111111">${escapeXml(subtitle)}</text>

  <text x="${W / 2}" y="${titleTopP + titleH * 0.72}" text-anchor="middle" font-size="210" font-family="Anton" font-weight="400" fill="url(#afro)" stroke="#161616" stroke-width="2.2" paint-order="stroke fill" stroke-linejoin="round">${escapeXml(title)}</text>

  <text text-anchor="middle" font-size="87" font-family="Montserrat-ExtraBoldItalic" font-style="italic" font-weight="800" fill="#B3121A" transform="translate(${W / 2},${yearYp}) skewX(-8)">${escapeXml(parts.year)}</text>

  <g font-family="Montserrat" fill="#111111">
    <line x1="${sep1X}" y1="${sepY1}" x2="${sep1X}" y2="${sepY2}" stroke="#D4A017" stroke-width="1.5"/>
    <line x1="${sep2X}" y1="${sepY1}" x2="${sep2X}" y2="${sepY2}" stroke="#D4A017" stroke-width="1.5"/>
    ${qrCardBlock ? `<line x1="${sep3X}" y1="${sepY1}" x2="${sep3X}" y2="${sepY2}" stroke="#D4A017" stroke-width="1.5"/>` : ''}

    <g transform="translate(${col1X},${infoYp - 28})">
      <rect x="0" y="0" width="44" height="38" rx="5" fill="none" stroke="#111111" stroke-width="2.5"/>
      <line x1="0" y1="12" x2="44" y2="12" stroke="#111111" stroke-width="2.5"/>
      <line x1="12" y1="-5" x2="12" y2="6" stroke="#111111" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="32" y1="-5" x2="32" y2="6" stroke="#111111" stroke-width="2.5" stroke-linecap="round"/>
      <text x="58" y="30" font-size="44" font-family="Montserrat-Medium" font-weight="500" fill="#111111">${escapeXml(parts.date)}</text>
    </g>

    <g transform="translate(${col2X},${infoYp - 30})">
      <circle cx="22" cy="22" r="22" fill="none" stroke="#111111" stroke-width="2.5"/>
      <path d="M22 10 V24 L33 32" fill="none" stroke="#111111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="54" y="32" font-size="40" font-family="Montserrat-Medium" font-weight="500" fill="#111111">${escapeXml(parts.time)}</text>
    </g>

    <g transform="translate(${col3X},${infoYp - 38})">
      <path d="M22 0 C10 0 0 10 0 22 C0 40 22 62 22 62 C22 62 44 40 44 22 C44 10 34 0 22 0 Z" fill="none" stroke="#111111" stroke-width="2.5"/>
      <circle cx="22" cy="22" r="8" fill="none" stroke="#111111" stroke-width="2.5"/>
      <text x="56" y="18" font-size="18" font-family="Montserrat-Bold" font-weight="700" fill="#111111">LOCAL:</text>
      <text x="56" y="44" font-size="24" font-family="Montserrat-Bold" font-weight="700" fill="#111111">${locTspans}</text>
    </g>

    ${qrCardBlock}
  </g>
  ${dressBlock}
  </svg>`;

  SVGtoPDF(doc, svg, 0, 0, { width, height, preserveAspectRatio: 'xMidYMid meet' });

  // Draw QR content inside the card (vector QR or uploaded image)
  if (qrConfig.imageUrl) {
    const img = await fetchImageBuffer(qrConfig.imageUrl);
    if (img) {
      const qrX = (qrCardX + qrPad) / W * width;
      const qrY = (qrCardY + qrPad) / H * height;
      const qrS = qrInner / W * width;
      try { doc.image(img, qrX, qrY, { fit: [qrS, qrS], align: 'center', valign: 'center' }); } catch { /* ignore invalid image */ }
    }
  } else if (qrConfig.url) {
    const qrS = qrCardSize / W * width;
    const qrX = qrCardX / W * width;
    const qrY = qrCardY / H * height;
    await drawQrWithLogo(doc, qrX, qrY, qrS, qrConfig.url, '#111111', '#D4A017', undefined, qrConfig.icon);
  }

  // Logo as raster image on top of SVG for reliability (SVG image href may not render in svg-to-pdfkit)
  if (hasLogo) {
    const logoBuf = await fetchImageBuffer(logoUrl);
    if (logoBuf) {
      const logoCenterY = H * 0.119 - shiftUp;
      const lx = ((W - logoPx) / 2) / W * width;
      const ly = (logoCenterY - logoPx / 2) / H * height;
      const ls = logoPx / W * width;
      doc.save();
      if (logoShape === 'circle') {
        doc.circle(lx + ls / 2, ly + ls / 2, ls / 2).clip();
      }
      try { doc.image(logoBuf, lx, ly, { fit: [ls, ls], align: 'center', valign: 'center' }); } catch { /* ignore */ }
      doc.restore();
      if (logoShape === 'circle') {
        doc.circle(lx + ls / 2, ly + ls / 2, ls / 2).lineWidth(Math.max(1, ls * 0.03)).strokeColor('#D4A017').stroke();
      }
    }
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

type RenderableLine = { block: string; label?: string; text: string; style?: any };

function documentToLines(manifest: TemplateManifest, event: EventRecord, invitation: Invitation): RenderableLine[] | null {
  const doc = (manifest as any).document;
  if (!doc || doc.version !== 2 || !Array.isArray(doc.blocks)) return null;
  const lines: RenderableLine[] = [];
  for (const b of doc.blocks as any[]) {
    if (!b || b.visible === false) continue;
    const style = b.style;
    switch (b.type) {
      case 'title':
        lines.push({ block: 'title', text: String(b.text || event.title || ''), style });
        break;
      case 'text':
      case 'message':
        if (b.text) lines.push({ block: b.type, label: b.label, text: String(b.text), style });
        break;
      case 'datetime':
        lines.push({ block: 'datetime', label: 'Quando', text: formatDisplayDateTime(event.startsAt), style });
        break;
      case 'location': {
        const txt = locationText(event);
        if (txt) lines.push({ block: 'location', label: 'Onde', text: txt, style });
        break;
      }
      case 'dress_code':
        if (b.text || event.dressCode) lines.push({ block: 'text', label: 'Dress code', text: String(b.text || event.dressCode || ''), style });
        break;
      case 'divider':
        lines.push({ block: 'divider', text: '', style });
        break;
      case 'countdown':
      case 'timeline':
      case 'gifts':
      case 'image':
      case 'gallery':
      case 'music_video':
      case 'qr':
      case 'buttons':
      case 'ornament':
        // Render simple placeholder/label for unsupported rich blocks in PDF for now
        if (b.text) lines.push({ block: 'text', text: String(b.text), style });
        break;
      default:
        if (b.text) lines.push({ block: 'text', text: String(b.text), style });
    }
  }
  // ensure guest/table present
  if (!lines.some((l) => l.block === 'guest')) {
    const guestKind = invitation.guestKind ?? null;
    const guestLabel = guestKind === 'couple' || guestKind === 'family' ? 'Convidados' : guestKind === 'female' ? 'Convidada' : guestKind === 'male' ? 'Convidado' : 'Convidado(a)';
    lines.push({ block: 'guest', label: guestLabel, text: invitation.guestName });
  }
  if (event.useTables && invitation.tableName?.trim() && !lines.some((l) => l.block === 'table')) {
    lines.push({ block: 'table', label: 'Mesa', text: invitation.tableName.trim() });
  }
  return lines;
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

      const docLines = documentToLines(manifest, event, invitation) ?? invitationLines(event, invitation, manifest);
      for (const line of docLines as any[]) {
        const st = line.style ?? {};
        const lineAlign = st.align || align;
        const lineColor = st.color || ink;
        const fontRole = st.fontFamily || (line.block === 'title' ? display : body);
        const fontWeight = st.fontWeight === 'bold' ? 'bold' : line.block === 'title' ? 'bold' : 'regular';
        if (line.block === 'divider') {
          drawDivider(doc, manifest, margin, width);
          continue;
        }
        if (line.block === 'title') {
          const text = display === 'cap' && !st.fontFamily ? line.text.toUpperCase() : line.text;
          const size = typeof st.fontSize === 'number' ? st.fontSize : display === 'script' ? 34 : 28;
          doc.font(fontFor(fontRole, 'bold')).fontSize(size).fillColor(lineColor);
          doc.text(text, margin, doc.y, { width, align: lineAlign, lineGap: 2 });
          drawDivider(doc, manifest, margin, width);
          continue;
        }
        if (line.block === 'message') {
          doc.moveDown(0.4);
          const size = typeof st.fontSize === 'number' ? st.fontSize : 11;
          doc.font(fontFor(fontRole, fontWeight)).fontSize(size).fillColor(lineColor);
          doc.text(line.text, margin, doc.y, { width, align: lineAlign, lineGap: 3 });
          doc.moveDown(0.6);
          continue;
        }
        if (line.block === 'guest') drawDivider(doc, manifest, margin, width);
        if (line.label) {
          doc.font(fontFor(body, 'bold')).fontSize(9).fillColor(accent);
          doc.text(String(line.label).toUpperCase(), margin, doc.y, { width, align: lineAlign, characterSpacing: 1.2 });
        }
        const size = typeof st.fontSize === 'number' ? st.fontSize : line.block === 'guest' ? 15 : 12.5;
        doc.font(fontFor(fontRole, fontWeight)).fontSize(size).fillColor(lineColor);
        doc.text(line.text, margin, doc.y, { width, align: lineAlign, lineGap: 2 });
        doc.moveDown(0.7);
      }

      const eventPublicUrl = event.publicSlug ? links.publicEvent(event.publicSlug) : null;
      const qrConfig = resolveQrConfig(manifest, invitationUrl, eventPublicUrl);
      const hasQr = Boolean(qrConfig.url || qrConfig.imageUrl);

      if (hasQr) {
        const maxSize = Math.min(width * 0.45, mm(42));
        const size = Math.min(maxSize, qrConfig.size === 'lg' ? mm(40) : mm(34));
        const legend = qrConfig.label;
        if (doc.y + size + mm(18) > doc.page.height - margin) doc.addPage();
        const y = doc.y + mm(8);
        const position = manifest.pdf.qr_position;
        const x =
          position === 'bottom-center'
            ? margin + (width - size) / 2
            : position === 'bottom-left'
              ? margin
              : margin + width - size;
        if (qrConfig.imageUrl) {
          const img = await fetchImageBuffer(qrConfig.imageUrl);
          if (img) {
            const pad = size * 0.08;
            doc.save();
            doc.lineWidth(Math.max(0.6, size * 0.018)).strokeColor(accent);
            doc.roundedRect(x, y, size, size, Math.max(mm(2), size * 0.08)).fillAndStroke('#FFFFFF', accent);
            try { doc.image(img, x + pad, y + pad, { fit: [size - pad * 2, size - pad * 2], align: 'center', valign: 'center' }); } catch { /* ignore */ }
            doc.restore();
            if (legend) {
              doc.font(resolveCatalogFont(body, 'regular')).fontSize(7).fillColor(accent);
              doc.text(legend.toUpperCase(), x, y - mm(4), { width: size, align: 'center', characterSpacing: 0.8 });
            }
          }
        } else if (qrConfig.url) {
          await drawQrWithLogo(doc, x, y, size, qrConfig.url, ink, accent, legend, qrConfig.icon);
        }
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
