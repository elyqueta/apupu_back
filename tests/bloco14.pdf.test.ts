import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { invitationLines, renderInvitationPdf } from '../src/services/pdf/invitationDocument';
import {
  BASE_FONT_SIZE,
  CANVAS_WIDTH,
  fitGratitudeTitle,
  fitGratitudeTitleFontSize,
  MAX_TITLE_WIDTH,
  MIN_FONT_SIZE,
  STEP,
} from '../src/services/pdf/gratitude-title';
import { DEFAULT_MANIFEST, TemplateManifest } from '../src/types/templateManifest';

const longAddress =
  'Rua Comandante Gika, Edifício Torres Atlântico, Bloco B, 7.º andar, Porta 12, ' +
  'junto ao antigo mercado do Alvalade, Bairro Maianga, Município de Luanda, Província de Luanda, Angola — ' +
  'entrada pelo portão lateral, estacionamento na rua de trás';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    title: 'Renovação de votos de Elizandra e Mateus com um título bastante longo para testar quebras',
    hostName: 'Família Sassapa',
    startsAt: new Date('2026-12-20T15:00:00Z'),
    rsvpDeadline: new Date('2026-12-10T23:00:00Z'),
    message: 'Celebre connosco este dia especial.',
    location: { type: 'venue', name: 'Igreja Sagrada Família', address: longAddress, onlineUrl: null },
    useTables: false,
    ...overrides,
  } as never;
}

const invitation = { guestName: 'Ana Maria da Conceição', tableName: 'Mesa 4', rsvpStatus: 'accepted' } as never;

/** Tamanhos de fonte (Tf) escritos nos fluxos de conteúdo do PDF. */
function pdfFontSizes(buffer: Buffer): number[] {
  const raw = buffer.toString('latin1');
  const sizes: number[] = [];
  for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const content = inflateSync(Buffer.from(stream[1]!, 'latin1')).toString('latin1');
      for (const tf of content.matchAll(/\/F\d+ ([\d.]+) Tf/g)) sizes.push(Number(tf[1]));
    } catch {
      // fluxo binário ou não comprimido: ignorar
    }
  }
  return sizes;
}

const manifests: Record<string, TemplateManifest> = {
  neutral: DEFAULT_MANIFEST,
  ivory: {
    ...DEFAULT_MANIFEST,
    palette: { bg: '#FBF7EF', surface: '#FFFDF8', ink: '#3A2F1E', accent: '#B8913A', muted: '#8A7A5C' },
    fonts: { display: 'script', body: 'serif' },
    ornaments: { frame: 'thin-gold', corners: 'floral', divider: 'flourish' },
    layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'deadline', 'message'] },
    pdf: { frame: 'double', qr_position: 'bottom-center', show_ornaments: true },
  },
  worship: {
    ...DEFAULT_MANIFEST,
    palette: { bg: '#0F1E3D', surface: '#16284D', ink: '#F5EEDC', accent: '#D8B76A', muted: '#A9B3C9' },
    fonts: { display: 'cap', body: 'serif' },
    layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'message', 'deadline'] },
    pdf: { frame: 'single', qr_position: 'bottom-center', show_ornaments: true },
    ornaments: { frame: 'thin-gold', corners: 'rays', divider: 'star' },
  },
};

describe('Bloco 14 — PDF "Convite"', () => {
  it('sem "Bilhete", sem estado de resposta nem "Respondeu em"', () => {
    const text = invitationLines(event(), invitation, DEFAULT_MANIFEST)
      .map((line) => `${line.label ?? ''} ${line.text}`)
      .join('\n');
    expect(text).not.toMatch(/Bilhete|Respondeu|Confirmado|Estado/);
    expect(text).toContain(longAddress);
  });

  it('a mesa só aparece com mesas ativas no evento', () => {
    expect(invitationLines(event(), invitation, DEFAULT_MANIFEST).some((l) => l.block === 'table')).toBe(false);
    expect(invitationLines(event({ useTables: true }), invitation, DEFAULT_MANIFEST).some((l) => l.block === 'table')).toBe(true);
  });

  it('respeita a ordem dos blocos do manifesto', () => {
    const blocks = invitationLines(event(), invitation, manifests['worship']!).map((l) => l.block);
    expect(blocks.indexOf('message')).toBeLessThan(blocks.indexOf('deadline'));
  });

  it.each(Object.keys(manifests))('gera um PDF válido (%s) com endereço longo', async (name) => {
    const buffer = await renderInvitationPdf(
      event({ useTables: true, message: 'Texto longo. '.repeat(40) }),
      invitation,
      manifests[name]!,
      'https://contocontigo.example/i/abc'
    );
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.toString('latin1')).toContain('/Title');
    const dir = process.env['PDF_SAMPLES_DIR'];
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `convite-${name}.pdf`), buffer);
    }
  });

  it('Bloco 15: embute 3 fontes diferentes no PDF', async () => {
    const manifest: TemplateManifest = {
      ...DEFAULT_MANIFEST,
      fonts: { display: 'condensed', body: 'serif' },
      layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'message'] },
    };
    const buffer = await renderInvitationPdf(
      event({ message: 'Mensagem de teste' }),
      invitation,
      manifest,
      'https://contocontigo.example/i/abc'
    );
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    const raw = buffer.toString('latin1');
    expect(raw).toMatch(/FontFile2|FontDescriptor/);
    for (const font of ['Oswald', 'CormorantGaramond', 'Figtree']) {
      expect(raw).toContain(font);
    }
  });

  it('Bloco 15: Gratitude PDF 4:5 portrait com fontes embutidas', async () => {
    const manifest: TemplateManifest = {
      ...DEFAULT_MANIFEST,
      palette: { bg: '#FFF6EA', surface: '#FFFDF8', ink: '#1A120B', accent: '#C8922A', muted: '#7A6248' },
      fonts: { display: 'condensed', body: 'sans' },
      ornaments: { frame: 'gratitude', corners: 'gratitude', divider: 'gratitude' },
      layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'message'] },
      pdf: { frame: 'none', qr_position: 'bottom-right', show_ornaments: true, qr_label: 'Informação', qr_destination: 'event' },
    };
    const buffer = await renderInvitationPdf(
      event({ title: 'GRATITUDE', hostName: 'IGREJA CRISTÃ REINO-CHURCH', dressCode: 'TRAJE AFRICANO' }),
      invitation,
      manifest,
      'https://contocontigo.example/i/abc'
    );
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    const raw = buffer.toString('latin1');
    // 1 página 4:5 (595.28 x 744.1)
    expect(raw).toContain('/MediaBox [0 0 595.28 744.1]');
    const pageCount = (raw.match(/\/Type \/Page[^s]/g) || []).length;
    expect(pageCount).toBe(1);
    // Fontes embutidas
    expect(raw).toMatch(/FontFile2|FontDescriptor/);
    // O Gratitude usa Anton (título/dress code) e Montserrat (org/sub/legendas).
    // Figtree/Cormorant pertencem ao template genérico, testado acima.
    for (const font of ['Anton', 'Montserrat']) {
      expect(raw).toContain(font);
    }
    // O convite Gratitude identifica o convidado destinatário.
    // O texto sai em subconjuntos de fontes; comparar os PDFs prova que o nome altera o documento.
    const withoutGuest = await renderInvitationPdf(
      event({ title: 'GRATITUDE', hostName: 'IGREJA CRISTÃ REINO-CHURCH', dressCode: 'TRAJE AFRICANO' }),
      { ...invitation, guestName: '' } as never,
      manifest,
      'https://contocontigo.example/i/abc'
    );
    expect(withoutGuest.equals(buffer)).toBe(false);
  });
});

describe('Bloco 14 — ajuste do título Gratitude', () => {
  const title = 'CELEBRAÇÃO DE GRATITUDE 2026';

  it('título curto mantém o tamanho base', () => {
    const visited: number[] = [];
    const size = fitGratitudeTitleFontSize(title, (text, fontSize) => {
      expect(text).toBe(title);
      visited.push(fontSize);
      return fontSize * 0.5;
    });
    expect(size).toBe(BASE_FONT_SIZE);
    expect(visited).toEqual([BASE_FONT_SIZE]);
  });

  it('título longo reduz o tamanho até caber na faixa', () => {
    const seen: number[] = [];
    const measure = (_text: string, fontSize: number) => {
      seen.push(fontSize);
      return fontSize * 6;
    };
    const size = fitGratitudeTitleFontSize(title, measure);
    expect(seen[0]).toBe(BASE_FONT_SIZE);
    expect(size).toBeLessThan(BASE_FONT_SIZE);
    expect(measure(title, size)).toBeLessThanOrEqual(MAX_TITLE_WIDTH);
    expect(measure(title, size + STEP)).toBeGreaterThan(MAX_TITLE_WIDTH);
  });

  it('título muito longo para no tamanho mínimo', () => {
    const size = fitGratitudeTitleFontSize(title, () => Number.POSITIVE_INFINITY);
    expect(size).toBe(MIN_FONT_SIZE);
    expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it('reduz de forma gradual, de STEP em STEP', () => {
    // Cada factor escolhido só cabe depois de mais um passo de redução.
    const sizes = [191, 186, 181].map((fitSize) =>
      fitGratitudeTitleFontSize(title, (_text, fontSize) => fontSize * (MAX_TITLE_WIDTH / fitSize))
    );
    expect(sizes).toEqual([BASE_FONT_SIZE - STEP, BASE_FONT_SIZE - 2 * STEP, BASE_FONT_SIZE - 3 * STEP]);
    expect(sizes[0]! - sizes[1]!).toBe(STEP);
    expect(sizes[1]! - sizes[2]!).toBe(STEP);

    const visited: number[] = [];
    fitGratitudeTitleFontSize(title, (_text, fontSize) => {
      visited.push(fontSize);
      return Number.POSITIVE_INFINITY;
    });
    expect(visited[0]).toBe(BASE_FONT_SIZE);
    expect(visited[1]).toBe(BASE_FONT_SIZE - STEP);
    expect(visited.every((fontSize) => fontSize >= MIN_FONT_SIZE)).toBe(true);
  });

  it('título extremamente longo alarga a viewBox em vez de cortar', () => {
    const widthAtMin = MAX_TITLE_WIDTH * 2;
    const fit = fitGratitudeTitle(title, (_text, fontSize) =>
      fontSize === MIN_FONT_SIZE ? widthAtMin : Number.POSITIVE_INFINITY
    );
    expect(fit.fontSize).toBe(MIN_FONT_SIZE);
    expect(fit.viewBoxWidth).toBeGreaterThan(CANVAS_WIDTH);
    // Com meet, a viewBox alargada escala o texto até caber na faixa visível.
    expect((widthAtMin * CANVAS_WIDTH) / fit.viewBoxWidth).toBeLessThanOrEqual(MAX_TITLE_WIDTH);
  });

  it('título curto mantém a viewBox base do poster', () => {
    const fit = fitGratitudeTitle('GRATITUDE', (_text, fontSize) => fontSize * 0.5);
    expect(fit.viewBoxWidth).toBe(CANVAS_WIDTH);
  });

  it('PDF Gratitude com título longo continua 4:5, de uma página e com Anton embutida', async () => {
    const manifest: TemplateManifest = {
      ...DEFAULT_MANIFEST,
      palette: { bg: '#FFF6EA', surface: '#FFFDF8', ink: '#1A120B', accent: '#C8922A', muted: '#7A6248' },
      fonts: { display: 'condensed', body: 'sans' },
      ornaments: { frame: 'gratitude', corners: 'gratitude', divider: 'gratitude' },
      layout: { align: 'center', blocks: ['title', 'host', 'datetime', 'location', 'message'] },
      pdf: { frame: 'none', qr_position: 'bottom-right', show_ornaments: true, qr_label: 'Informação', qr_destination: 'event' },
    };
    const buffer = await renderInvitationPdf(
      event({ title, hostName: 'IGREJA CRISTÃ REINO-CHURCH', dressCode: 'TRAJE AFRICANO' }),
      invitation,
      manifest,
      'https://contocontigo.example/i/abc'
    );
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    const raw = buffer.toString('latin1');
    expect(raw).toContain('/MediaBox [0 0 595.28 744.1]');
    expect((raw.match(/\/Type \/Page[^s]/g) || []).length).toBe(1);
    expect(raw).toContain('Anton');
    // O título já não é desenhado com o tamanho base: há um Tf reduzido, de STEP em STEP.
    const fontSizes = pdfFontSizes(buffer);
    expect(fontSizes.length).toBeGreaterThan(0);
    expect(fontSizes).not.toContain(BASE_FONT_SIZE);
    expect(
      fontSizes.some((size) => size >= MIN_FONT_SIZE && size < BASE_FONT_SIZE && size % STEP === 0)
    ).toBe(true);
  });
});
