import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import catalog from '../src/assets/templates/system-templates.json';
import { toTemplateDto } from '../src/dto/invitation.dto';
import { documentToLines, invitationLines, renderInvitationPdf } from '../src/services/pdf/invitationDocument';
import { EventTemplate } from '../src/types/template.types';
import { DEFAULT_MANIFEST, parseManifest } from '../src/types/templateManifest';

type CatalogEntry = (typeof catalog)[number];

function toEventTemplate(entry: CatalogEntry): EventTemplate {
  return {
    id: `system-${entry.slug}`,
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    previewImageUrl: null,
    supportedFields: entry.supportedFields,
    themes: [{ mode: 'light', palette: 'default' }],
    isActive: true,
    sortOrder: entry.sortOrder,
    manifest: entry.manifest,
    kind: 'system',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('Bloco 15B — catálogo de templates', () => {
  it('o manifesto aceita orientation e previewData e recusa valores inválidos', () => {
    const parsed = parseManifest({
      ...DEFAULT_MANIFEST,
      orientation: 'story',
      previewData: { title: 'Ana & João', type: 'wedding' },
    });

    expect(parsed.orientation).toBe('story');
    expect(parsed.previewData?.['title']).toBe('Ana & João');
    expect(parsed.previewData?.['type']).toBe('wedding');
    expect(parseManifest({ ...DEFAULT_MANIFEST, orientation: 'poster' })).toEqual(DEFAULT_MANIFEST);
    expect(parseManifest({ ...DEFAULT_MANIFEST, previewData: { title: 1 } })).toEqual(DEFAULT_MANIFEST);
  });

  it('tem os 19 slugs únicos com documentos v2 completos', () => {
    expect(catalog).toHaveLength(19);
    const slugs = catalog.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(19);
    expect(slugs).toEqual(
      expect.arrayContaining([
        't01-papel-creme',
        't03-hacienda-marfim',
        't05-foto-desvanece',
        't08-salvia-eucalipto',
        't11-preto-dourado',
        't13-gradiente-verde-azul',
        't17-confraternizacao-dourada',
      ]),
    );

    for (const entry of catalog) {
      const manifest = parseManifest(entry.manifest);
      expect(manifest.orientation).toBeTruthy();
      expect(manifest.previewData?.['title']).toBeTruthy();
      expect(manifest.previewData?.['templateSlug']).toBe(entry.slug);
      expect(manifest.previewData?.['startsAt']).toContain('T');
      expect(manifest.document?.version).toBe(2);
      expect(manifest.document?.blocks.length).toBeGreaterThan(0);
      const ids = manifest.document?.blocks.map((block) => block.id) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('o DTO expõe kind system e preserva o manifesto de cada template', () => {
    for (const entry of catalog) {
      const dto = toTemplateDto(toEventTemplate(entry));
      expect(dto.kind).toBe('system');
      expect(dto.slug).toBe(entry.slug);
      expect(dto.manifest.orientation).toBeTruthy();
      expect(dto.manifest.previewData?.['templateSlug']).toBe(entry.slug);
      expect(dto.manifest.document?.version).toBe(2);
    }
  });

  it('a migração usa upsert por slug e não remove a coluna kind', () => {
    const source = readFileSync(
      new URL('../migrations/1739900000040_bloco15b_catalog.js', import.meta.url),
      'utf8',
    );
    expect(source).toContain('ON CONFLICT (slug) DO UPDATE SET');
    expect(source).toContain("kind = 'system'");
    expect(source).toContain('WHERE slug IN');
    expect(source).not.toContain('dropColumns');
    expect(source).not.toContain('DROP COLUMN');
  });

  it('o PDF preserva horas/etiquetas da timeline e os rótulos dos botões', () => {
    const manifest = {
      ...DEFAULT_MANIFEST,
      document: {
        version: 2,
        blocks: [
          {
            id: 'timeline',
            type: 'timeline',
            items: [
              { time: '16:00', label: 'Chegada' },
              { time: '18:00', label: 'Jantar' },
            ],
          },
          {
            id: 'buttons',
            type: 'buttons',
            buttons: [
              { action: 'rsvp', label: 'Confirmar presença' },
              { action: 'location', label: 'Ver localização' },
            ],
          },
        ],
      },
    } as never;
    const event = {
      id: 'e1',
      title: 'Evento',
      startsAt: new Date('2026-12-20T15:00:00Z'),
      location: { type: 'venue', name: 'Sala', address: 'Luanda' },
      useTables: false,
    } as never;
    const invitation = { guestName: 'Ana', rsvpStatus: 'accepted' } as never;
    const lines = documentToLines(manifest, event, invitation)!.map((line) => `${line.label ?? ''} ${line.text}`);
    expect(lines).toContain('16:00 Chegada');
    expect(lines).toContain('18:00 Jantar');
    expect(lines).toContain('Ação Confirmar presença');
    expect(lines).toContain('Ação Ver localização');
  });

  it('o PDF mapeia divisores, ornamento e média do documento v2', () => {
    const manifest = {
      ...DEFAULT_MANIFEST,
      document: {
        version: 2,
        blocks: [
          { id: 'd', type: 'divider', variant: 'torn-edge' },
          { id: 'o', type: 'ornament', ornament: 'leaf' },
          { id: 'g', type: 'gallery', urls: ['a.jpg', 'b.jpg'] },
          { id: 'm', type: 'music_video', youtubeId: 'abc123' },
          { id: 'i', type: 'image', alt: 'Fotografia do casal' },
        ],
      },
    } as never;
    const event = { id: 'e1', title: 'Evento', startsAt: new Date('2026-12-20T15:00:00Z') } as never;
    const invitation = { guestName: 'Ana', rsvpStatus: 'accepted' } as never;
    const lines = documentToLines(manifest, event, invitation)!;
    expect(lines.find((line) => line.block === 'divider')?.decoration).toBe('torn-edge');
    expect(lines.find((line) => line.block === 'ornament')?.decoration).toBe('leaf');
    expect(lines.find((line) => line.block === 'gallery')?.decoration).toBe('2');
    expect(lines.find((line) => line.block === 'music')?.decoration).toBe('abc123');
    expect(lines.find((line) => line.block === 'image')?.decoration).toBe('Fotografia do casal');
  });

  it('desenha mais vetores quando o documento v2 tem blocos ricos', async () => {
    const event = {
      id: 'e1',
      title: 'Evento',
      startsAt: new Date('2026-12-20T15:00:00Z'),
      location: { type: 'venue', name: 'Sala', address: 'Luanda' },
      useTables: false,
    } as never;
    const invitation = { guestName: 'Ana', rsvpStatus: 'accepted' } as never;
    const url = 'https://contocontigo.example/i/abc';
    const plain = await renderInvitationPdf(event, invitation, DEFAULT_MANIFEST, url);
    const richManifest = {
      ...DEFAULT_MANIFEST,
      document: {
        version: 2,
        blocks: [
          {
            id: 'timeline',
            type: 'timeline',
            items: [{ time: '16:00', label: 'Chegada' }],
          },
          { id: 'button', type: 'buttons', buttons: [{ action: 'rsvp', label: 'Confirmar presença' }] },
          { id: 'divider', type: 'divider', variant: 'torn-edge' },
          { id: 'ornament', type: 'ornament', ornament: 'leaf' },
          { id: 'gallery', type: 'gallery', urls: ['a.jpg', 'b.jpg', 'c.jpg'] },
        ],
      },
    } as never;
    const rich = await renderInvitationPdf(event, invitation, richManifest, url);

    // Conta operadores vetoriais nos fluxos de conteúdo descomprimidos: os
    // botões (retângulos arredondados), o eixo da timeline, o divisor rasgado,
    // o ornamento e os placeholders de galeria adicionam traços ao PDF.
    const vectorOps = (buffer: Buffer) => {
      let curves = 0;
      let rects = 0;
      for (const stream of buffer.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
        try {
          const content = inflateSync(Buffer.from(stream[1]!, 'latin1')).toString('latin1');
          curves += (content.match(/\bc\b/g) ?? []).length;
          rects += (content.match(/\bre\b/g) ?? []).length;
        } catch {
          // fluxo binário: ignorar
        }
      }
      return curves + rects;
    };
    expect(rich.subarray(0, 4).toString()).toBe('%PDF');
    expect(vectorOps(rich)).toBeGreaterThan(vectorOps(plain));
  });

  it('num evento de comunidade o convite mostra a comunidade como anfitrião', async () => {
    const event = {
      id: 'e1',
      title: 'Casamento dos loucos',
      hostName: 'Cláudio Sassapa',
      communityId: '9c0f7b3a-2d6e-4f9a-9a0a-2d6e4f9a9a0a',
      startsAt: new Date('2026-12-20T15:00:00Z'),
      location: { type: 'venue', name: 'Sala', address: 'Luanda' },
      useTables: false,
    } as never;
    const invitation = { guestName: 'Ana', rsvpStatus: 'accepted' } as never;
    const url = 'https://contocontigo.example/i/abc';
    const communityName = 'Clube dos Loucos';

    const lines = invitationLines({ ...event, hostName: communityName } as never, invitation, DEFAULT_MANIFEST);
    expect(lines.find((line) => line.block === 'host')?.text).toBe(communityName);

    const plain = await renderInvitationPdf(event, invitation, DEFAULT_MANIFEST, url);
    const asCommunity = await renderInvitationPdf(event, invitation, DEFAULT_MANIFEST, url, communityName);
    expect(plain.equals(asCommunity)).toBe(false);
    expect(asCommunity.subarray(0, 4).toString()).toBe('%PDF');
  });
});
