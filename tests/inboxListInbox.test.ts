import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  pool: {},
  query: vi.fn(),
}));

import { query } from '../src/database/pool';
import { invitationRepository } from '../src/repositories/invitation.repository';

/**
 * A caixa de entrada junta `invitations` e `events`. As duas tabelas têm
 * `id`, `created_at` e `updated_at`, pelo que qualquer coluna sem alias
 * na lista de SELECT provoca `42702: column reference is ambiguous`.
 */
function captureSql(index: number): string {
  return vi.mocked(query).mock.calls[index]?.[0] as string;
}

describe('listInbox · colunas qualificadas', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
  });

  it('qualifica as colunas do convite com o alias i na listagem', async () => {
    const result = await invitationRepository.listInbox({
      hostId: '11111111-1111-1111-1111-111111111111',
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);

    const countSql = captureSql(0);
    expect(countSql).toContain('SELECT count(*)::text AS total');

    const listSql = captureSql(1);
    expect(listSql).toContain('SELECT i.id, i.event_id, i.guest_name');
    expect(listSql).toContain('i.rsvp_status, i.rsvp_responded_at, i.rsvp_version');
    expect(listSql).toContain('i.send_status, i.send_count, i.last_sent_at, i.created_at, i.updated_at');
    expect(listSql).not.toMatch(/SELECT\s+(?:id|created_at|updated_at)\b/);
    expect(listSql).toContain('FROM invitations i JOIN events e ON e.id = i.event_id');
    expect(listSql).toContain('ORDER BY i.rsvp_responded_at DESC NULLS LAST, i.id DESC');
    expect(listSql).toContain('LIMIT $2 OFFSET $3');
  });

  it('mantém qualificados os filtros opcionais e a subconsulta de gestor', async () => {
    await invitationRepository.listInbox({
      hostId: '11111111-1111-1111-1111-111111111111',
      managerEmail: 'gestor@exemplo.ao',
      eventId: '22222222-2222-2222-2222-222222222222',
      q: 'Ana',
      read: 'unread',
      answered: 'unanswered',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
      limit: 10,
      offset: 10,
    });

    const listSql = captureSql(1);
    expect(listSql).toContain('SELECT i.id, i.event_id');
    expect(listSql).toContain('e.host_id = $1 OR EXISTS (');
    expect(listSql).toContain('FROM event_managers m');
    expect(listSql).toContain('m.event_id = i.event_id');
    expect(listSql).toContain('m.email = $2::citext');
    expect(listSql).toContain('i.event_id = $3');
    expect(listSql).toContain('i.guest_name ILIKE $4');
    expect(listSql).toContain('e.title ILIKE $7');
    expect(listSql).toContain('i.message_read_at IS NULL');
    expect(listSql).toContain('i.message_answered_at IS NULL');
    expect(listSql).toContain('i.rsvp_responded_at >=');
    expect(listSql).toContain('LIMIT $10 OFFSET $11');
  });
});
