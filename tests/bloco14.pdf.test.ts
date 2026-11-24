import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invitationLines, renderInvitationPdf } from '../src/services/pdf/invitationDocument';
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
});
