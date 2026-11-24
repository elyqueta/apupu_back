import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Cores oficiais do Conto Contigo usadas nos documentos. */
export const PDF_COLORS = {
  brand: '#0F3D3E',
  accent: '#E8B230',
  ink: '#14201F',
  muted: '#5B6B69',
  line: '#E4E2D8',
  stripe: '#F1F7F6',
  highlight: '#FBF1D6',
  white: '#FFFFFF',
  confirmedText: '#2E7D4F',
  confirmedBg: '#E6F3EB',
  pendingText: '#B7791F',
  pendingBg: '#FDF3DD',
  declinedText: '#B3382C',
  declinedBg: '#FBEAE8',
} as const;

export const PDF_FONTS = {
  regular: 'Figtree',
  bold: 'Figtree-Bold',
  extraBold: 'Figtree-ExtraBold',
} as const;

/**
 * Bloco 15: catálogo fechado de fontes locais embutidas no PDF.
 * Nunca CDN, nunca substituição silenciosa.
 */
export const FONT_CATALOG = {
  sans: { regular: 'Figtree', bold: 'Figtree-Bold', extraBold: 'Figtree-ExtraBold' },
  serif: { regular: 'CormorantGaramond', bold: 'CormorantGaramond-Bold', extraBold: 'CormorantGaramond-Bold' },
  cap: { regular: 'Cinzel', bold: 'Cinzel-Bold', extraBold: 'Cinzel-Bold' },
  script: { regular: 'PinyonScript', bold: 'PinyonScript', extraBold: 'PinyonScript' },
  condensed: { regular: 'Oswald', bold: 'Oswald-Bold', extraBold: 'Oswald-Bold' },
} as const;

export type PdfFontRole = keyof typeof FONT_CATALOG;

const POINTS_PER_MM = 72 / 25.4;

/** Converte milímetros para pontos PDF. */
export function mm(value: number): number {
  return value * POINTS_PER_MM;
}

export const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  marginX: mm(20),
  marginTop: mm(18),
  marginBottom: mm(20),
  headerHeight: mm(20),
  contentWidth: 595.28 - mm(40),
  contentBottom: 841.89 - mm(22),
  footerLineY: 841.89 - mm(16),
  footerTextY: 841.89 - mm(12),
} as const;

function assetPath(...parts: string[]): string {
  return path.join(__dirname, '..', '..', 'assets', ...parts);
}

let logoCache: string | null = null;
let watermarkCache: string | null = null;

/** Logótipo horizontal vetorial (38 mm no cabeçalho). */
export function logoHorizontalSvg(): string {
  if (!logoCache) {
    logoCache = readFileSync(assetPath('pdf', 'logo-horizontal.svg'), 'utf8');
  }
  return logoCache;
}

/**
 * Símbolo do pin usado como marca de água.
 *
 * A opacidade viaja dentro do próprio SVG (`stroke-opacity`/
 * `fill-opacity`). O `svg-to-pdfkit` reaplica a cor de traço com a
 * opacidade recebida no ficheiro, pelo que definir apenas
 * `doc.opacity()` antes de o desenhar não é suficiente: a cor do SVG
 * repõe a opacidade a 1.
 */
export function watermarkSvg(opacity = 0.06): string {
  if (!watermarkCache) {
    watermarkCache = readFileSync(assetPath('pdf', 'watermark-symbol.svg'), 'utf8');
  }

  const value = String(opacity);
  return watermarkCache
    .replace(/stroke="#0F3D3E"/g, `stroke="#0F3D3E" stroke-opacity="${value}"`)
    .replace(/fill="#0F3D3E"/g, `fill="#0F3D3E" fill-opacity="${value}"`);
}

function fontAssetPath(file: string): string {
  const fontsDir = path.join(__dirname, '..', '..', 'assets', 'fonts');
  const pdfDir = path.join(__dirname, '..', '..', 'assets', 'pdf');
  const inFonts = path.join(fontsDir, file);
  const inPdf = path.join(pdfDir, file);
  try { readFileSync(inFonts); return inFonts; } catch { /* fallback */ }
  try { readFileSync(inPdf); return inPdf; } catch { /* fallback */ }
  return inFonts;
}

/** Regista todas as fontes do catálogo, embutidas no PDF. */
export function registerFonts(doc: PDFKit.PDFDocument): void {
  const files: Array<[string, string]> = [
    ['Figtree', 'Figtree-400.ttf'],
    ['Figtree-Bold', 'Figtree-700.ttf'],
    ['Figtree-ExtraBold', 'Figtree-800.ttf'],
    ['CormorantGaramond', 'CormorantGaramond-400.ttf'],
    ['CormorantGaramond-Bold', 'CormorantGaramond-700.ttf'],
    ['Cinzel', 'Cinzel-400.ttf'],
    ['Cinzel-Bold', 'Cinzel-700.ttf'],
    ['PinyonScript', 'PinyonScript-400.ttf'],
    ['Oswald', 'Oswald-400.ttf'],
    ['Oswald-Bold', 'Oswald-700.ttf'],
  ];
  for (const [name, file] of files) {
    const full = fontAssetPath(file);
    try {
      doc.registerFont(name, full);
    } catch (error) {
      throw new Error(`Fonte do PDF em falta ou inválida: ${file} (${String(error)})`, { cause: error });
    }
  }
}

/** Resolve nome da fonte embutida pelo papel do catálogo. */
export function resolveCatalogFont(role: string, weight: 'regular' | 'bold' | 'extraBold' = 'regular'): string {
  const entry = (FONT_CATALOG as Record<string, { regular: string; bold: string; extraBold: string }>)[role];
  if (!entry) {
    throw new Error(`Fonte do catálogo desconhecida: ${role}`);
  }
  return entry[weight];
}
