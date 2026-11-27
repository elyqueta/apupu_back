/**
 * Ajuste do título do convite Gratitude (4:5).
 *
 * O título é desenhado numa faixa de largura fixa do canvas SVG (1024 unidades).
 * Títulos longos são reduzidos de 5 em 5 até caberem nessa faixa, sem nunca
 * descer abaixo do tamanho mínimo legível.
 */

/** Tamanho original do título, em unidades do canvas SVG. */
export const BASE_FONT_SIZE = 195;

/** Tamanho mínimo admitido para o título, em unidades do canvas SVG. */
export const MIN_FONT_SIZE = 54;

/** Redução aplicada em cada tentativa, em unidades do canvas SVG. */
export const STEP = 5;

/** Largura do canvas SVG do poster (viewBox 0 0 1024 1280). */
export const CANVAS_WIDTH = 1024;

/** Largura útil do título: 91% do canvas (0.91 * 1024 = 931.84). */
export const MAX_TITLE_WIDTH = 0.91 * CANVAS_WIDTH;

/** Margem lateral deixada dentro da viewBox do título. */
export const TITLE_PAD = 4;

/** Mede a largura do título em unidades do canvas SVG, para um dado tamanho de fonte. */
export type TitleWidthMeasure = (title: string, fontSize: number) => number;

/** Resultado do ajuste: tamanho escolhido e viewBox que garante que nada é cortado. */
export interface GratitudeTitleFit {
  fontSize: number;
  viewBoxWidth: number;
}

/**
 * Escolhe o maior tamanho de fonte (BASE, BASE-STEP, ...) que faz o título
 * caber em MAX_TITLE_WIDTH. Função pura: a medição é injectada pelo chamador.
 */
export function fitGratitudeTitleFontSize(
  title: string,
  measure: TitleWidthMeasure,
): number {
  for (
    let fontSize = BASE_FONT_SIZE;
    fontSize >= MIN_FONT_SIZE;
    fontSize -= STEP
  ) {
    if (measure(title, fontSize) <= MAX_TITLE_WIDTH) return fontSize;
  }
  return MIN_FONT_SIZE;
}

/**
 * Calcula também a viewBox do `<svg>` que envolve o título. Quando o título
 * continua maior que a faixa mesmo no tamanho mínimo, a viewBox alarga e o
 * `preserveAspectRatio="xMidYMid meet"` reduz o texto de forma uniforme —
 * o mesmo comportamento do convite digital, sem distorcer glyphs nem cortar.
 */
export function fitGratitudeTitle(
  title: string,
  measure: TitleWidthMeasure
): GratitudeTitleFit {
  const fontSize = fitGratitudeTitleFontSize(title, measure);
  const width = measure(title, fontSize);
  // Com preserveAspectRatio="meet", a escala final é CANVAS_WIDTH / viewBoxWidth.
  // Exigir viewBoxWidth >= width * CANVAS_WIDTH / MAX_TITLE_WIDTH garante que o
  // texto escalado continua dentro da faixa de 91% do poster.
  const fittedWidth = Math.ceil((width * CANVAS_WIDTH) / MAX_TITLE_WIDTH) + TITLE_PAD;
  return {
    fontSize,
    viewBoxWidth: Math.max(CANVAS_WIDTH, fittedWidth),
  };
}
