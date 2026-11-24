import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

import { query } from '../src/database/pool';
import { updateEventSchema } from '../src/schemas/event.schemas';
import { saveEventDraftSchema } from '../src/schemas/eventDraft.schemas';
import { eventDraftService } from '../src/services/eventDraft.service';
import { invitePresentationService } from '../src/services/invitePresentation.service';
import { DEFAULT_MANIFEST, parseManifest } from '../src/types/templateManifest';
import { youtubeVideoId } from '../src/utils/youtube.util';

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('Bloco 14 — vídeo do YouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'dQw4w9WgXcQ'],
  ])('extrai o ID de %s', (url, id) => {
    expect(youtubeVideoId(url)).toBe(id);
  });

  it.each(['https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'abc', 'https://youtu.be/short'])(
    'recusa %s',
    (url) => {
      expect(youtubeVideoId(url)).toBeNull();
    }
  );

  it('o schema guarda só o ID e recusa links inválidos com mensagem em pt-PT', () => {
    const ok = updateEventSchema.safeParse({ youtube_url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(ok.success && ok.data.youtube_url).toBe('dQw4w9WgXcQ');
    const bad = updateEventSchema.safeParse({ youtube_url: 'https://vimeo.com/1' });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('Link do YouTube inválido');
    const cleared = updateEventSchema.safeParse({ youtube_url: '' });
    expect(cleared.success && cleared.data.youtube_url).toBeNull();
  });
});

describe('Bloco 14 — localização exata', () => {
  const venue = { type: 'venue', name: 'Igreja', address: 'Rua 1' };

  it('latitude e longitude vêm juntas e dentro dos limites', () => {
    expect(updateEventSchema.safeParse({ location: { ...venue, latitude: -8.83, longitude: 13.23 } }).success).toBe(true);
    expect(updateEventSchema.safeParse({ location: { ...venue, latitude: -8.83 } }).success).toBe(false);
    expect(updateEventSchema.safeParse({ location: { ...venue, latitude: 91, longitude: 0 } }).success).toBe(false);
  });
});

describe('Bloco 14 — manifesto', () => {
  it('manifesto inválido cai no neutro', () => {
    expect(parseManifest({ version: 2 })).toEqual(DEFAULT_MANIFEST);
    expect(parseManifest(null)).toEqual(DEFAULT_MANIFEST);
  });

  it('fontes fora da lista permitida são recusadas', () => {
    expect(parseManifest({ ...DEFAULT_MANIFEST, fonts: { display: 'Comic Sans', body: 'sans' } })).toEqual(DEFAULT_MANIFEST);
  });
});

describe('Bloco 14 — organizadores', () => {
  it('evento de comunidade: só responsável e gestores activos, nunca membros', async () => {
    await invitePresentationService.organizers({ id: 'e1', communityId: 'c1' } as never);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain("m.role IN ('owner', 'manager')");
    expect(sql).toContain("m.status = 'active'");
    expect(sql).not.toContain("'member'");
  });

  it('telefone vazio não é exposto', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ display_name: 'Ana', avatar_url: null, role: 'owner', email: 'a@x.ao', phone: '  ' }],
      rowCount: 1,
    } as never);
    const [organizer] = await invitePresentationService.organizers({ id: 'e1', communityId: null } as never);
    expect(organizer?.phone).toBeNull();
  });
});

describe('Bloco 14 — rascunhos', () => {
  it('são sempre filtrados pelo anfitrião', async () => {
    await expect(eventDraftService.get('host-a', 'd1')).rejects.toMatchObject({ statusCode: 404 });
    const [sql, values] = vi.mocked(query).mock.calls[0] ?? [];
    expect(String(sql)).toContain('host_id = $2');
    expect(values).toEqual(['d1', 'host-a']);
  });

  it('limite de rascunhos por anfitrião', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ count: 20 }], rowCount: 1 } as never);
    await expect(eventDraftService.create('h', { step: 0, payload: {} })).rejects.toMatchObject({ code: 'event_draft_limit' });
  });

  it('payload demasiado grande é recusado', () => {
    expect(saveEventDraftSchema.safeParse({ step: 1, payload: { x: 'a'.repeat(70_000) } }).success).toBe(false);
  });
});
