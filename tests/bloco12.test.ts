import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock('../src/repositories/notification.repository', () => ({
  notificationRepository: { createForHost: vi.fn() },
}));

import { query } from '../src/database/pool';
import { notificationRepository } from '../src/repositories/notification.repository';
import { socialRepository } from '../src/repositories/social.repository';
import {
  decodeCursor,
  encodeCursor,
  socialService,
  toFeedPersonDto,
} from '../src/services/social.service';

const sqlCalls = (): string[] => vi.mocked(query).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
  vi.mocked(notificationRepository.createForHost).mockReset();
});

describe('Bloco 12 — feed e pesquisa (testes negativos)', () => {
  it('eventos do feed: só públicos, não removidos, próximos ou a decorrer', async () => {
    await socialService.feed({ type: 'events' });
    const sql = sqlCalls().at(-1) ?? '';
    expect(sql).toContain("e.visibility = 'public'");
    expect(sql).toContain('e.deleted_at IS NULL');
    expect(sql).toContain('>= now()');
    expect(sql).toContain("e.status = 'scheduled'");
  });

  it('pessoas: só perfis públicos, activos e verificados', async () => {
    await socialService.feed({ type: 'people' });
    const sql = sqlCalls().at(-1) ?? '';
    expect(sql).toContain("h.profile_visibility = 'public'");
    expect(sql).toContain("h.status = 'active'");
  });

  it('comunidades: só públicas', async () => {
    await socialService.feed({ type: 'communities' });
    expect(sqlCalls().at(-1)).toContain("c.visibility = 'public'");
  });

  it('a pesquisa escapa curingas e aplica as mesmas regras a cada grupo', async () => {
    await socialService.search('50%_off');
    const calls = vi.mocked(query).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [sql, values] of calls) {
      expect(String(sql)).toContain("ESCAPE '\\'");
      expect((values as unknown[]).some((value) => value === '%50\\%\\_off%')).toBe(true);
    }
    expect(String(calls[0]?.[0])).toContain("e.visibility = 'public'");
    expect(String(calls[2]?.[0])).toContain("h.profile_visibility = 'public'");
  });

  it('pesquisa com menos de 2 caracteres não consulta a base', async () => {
    expect(await socialService.search('a')).toEqual({ events: [], communities: [], people: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('o DTO de pessoa nunca inclui contactos', () => {
    const dto = toFeedPersonDto({
      id: 'p1',
      display_name: 'Ana',
      avatar_url: null,
      cover_url: null,
      ...({ email: 'ana@x.ao', phone: '+244', birth_date: '2000-01-01' } as object),
    } as never);
    expect(Object.keys(dto).sort()).toEqual(['avatar_url', 'cover_url', 'display_name', 'id', 'type']);
  });

  it('cursor opaco e limitado', () => {
    expect(decodeCursor(encodeCursor(24))).toBe(24);
    expect(decodeCursor('lixo!!')).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
  });

  it('o feed indica a página seguinte quando há mais de 12', async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      id: `p${index}`,
      display_name: `P${index}`,
      avatar_url: null,
      cover_url: null,
    }));
    vi.mocked(query).mockResolvedValueOnce({ rows, rowCount: 13 } as never);
    const page = await socialService.feed({ type: 'people' });
    expect(page.items).toHaveLength(12);
    expect(page.next_cursor).toBe(encodeCursor(12));
  });
});

describe('Bloco 12 — perfis e amizades', () => {
  it('perfil privado (não encontrado pela consulta pública) dá 404', async () => {
    await expect(socialService.publicProfile('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(sqlCalls().at(-1)).toContain("h.profile_visibility = 'public'");
    await expect(socialService.profile('00000000-0000-4000-8000-000000000001', 'viewer')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('não se pode pedir amizade a si próprio', async () => {
    await expect(socialService.requestFriend({ hostId: 'me', name: 'Eu' }, 'me')).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('pedir amizade a perfil privado dá 404', async () => {
    vi.spyOn(socialRepository, 'findPublicPerson').mockResolvedValueOnce(null);
    await expect(socialService.requestFriend({ hostId: 'me', name: 'Eu' }, 'other')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('respeita o limite diário e notifica o destinatário', async () => {
    const person = { id: 'other', display_name: 'Outro', avatar_url: null, cover_url: null };
    vi.spyOn(socialRepository, 'findPublicPerson').mockResolvedValue(person);
    vi.spyOn(socialRepository, 'findFriendship').mockResolvedValue(null);
    vi.spyOn(socialRepository, 'requestsSentToday').mockResolvedValueOnce(30);
    await expect(socialService.requestFriend({ hostId: 'me', name: 'Eu' }, 'other')).rejects.toMatchObject({
      code: 'friend_request_limit',
    });

    vi.spyOn(socialRepository, 'requestsSentToday').mockResolvedValueOnce(0);
    vi.spyOn(socialRepository, 'upsertRequest').mockResolvedValueOnce('f1');
    await socialService.requestFriend({ hostId: 'me', name: 'Eu' }, 'other');
    expect(notificationRepository.createForHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'other', kind: 'friend_request' })
    );
  });

  it('só o destinatário aceita um pedido', async () => {
    vi.spyOn(socialRepository, 'findFriendshipById').mockResolvedValue({
      id: 'f1',
      requester_id: 'a',
      addressee_id: 'b',
      status: 'pending',
    });
    await expect(socialService.respond({ hostId: 'a', name: 'A' }, 'f1', true)).rejects.toMatchObject({
      statusCode: 404,
    });
    const respond = vi.spyOn(socialRepository, 'respond').mockResolvedValue();
    await socialService.respond({ hostId: 'b', name: 'B' }, 'f1', true);
    expect(respond).toHaveBeenCalledWith('f1', 'accepted');
  });
});
