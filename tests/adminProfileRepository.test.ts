import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

import { query } from '../src/database/pool';
import { adminProfileRepository } from '../src/repositories/adminProfile.repository';

const queryMock = vi.mocked(query);

describe('adminProfileRepository.teamsForUser', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] } as never);
  });

  it('usa removed_at para membros e deleted_at para equipas', async () => {
    await adminProfileRepository.teamsForUser('host-1', 50);

    expect(queryMock).toHaveBeenCalledOnce();
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toContain('tm.removed_at IS NULL');
    expect(sql).not.toContain('tm.deleted_at');
    expect(sql).toContain('t.deleted_at IS NULL');
    expect(queryMock.mock.calls[0][1]).toEqual(['host-1', 50]);
  });

  it('conta os membros activos e devolve o título do evento', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'team-1',
          name: 'Decoração',
          member_count: '4',
          event_title: 'Casamento da Ana',
        },
      ],
    } as never);

    await expect(adminProfileRepository.teamsForUser('host-1', 50)).resolves.toEqual([
      {
        id: 'team-1',
        name: 'Decoração',
        member_count: 4,
        event_title: 'Casamento da Ana',
      },
    ]);
  });
});
