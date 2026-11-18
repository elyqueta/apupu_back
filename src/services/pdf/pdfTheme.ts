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

/** Símbolo do pin usado como marca de água. */
export function watermarkSvg(): string {
  if (!watermarkCache) {
    watermarkCache = readFileSync(assetPath('pdf', 'watermark-symbol.svg'), 'utf8');
  }
  return watermarkCache;
}

/** Regista as três variantes da Figtree embebidas no PDF. */
export function registerFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(PDF_FONTS.regular, assetPath('pdf', 'Figtree-400.ttf'));
  doc.registerFont(PDF_FONTS.bold, assetPath('pdf', 'Figtree-700.ttf'));
  doc.registerFont(PDF_FONTS.extraBold, assetPath('pdf', 'Figtree-800.ttf'));
}
