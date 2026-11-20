import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  pool: {},
  query: vi.fn(),
}));

import { query } from '../src/database/pool';
import { invitationRepository } from '../src/repositories/invitation.repository';

describe('atalho de registo para convidados', () => {
  it('só aceita convites reclamados, não revogados e de eventos recentes', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);

    await invitationRepository.findLatestGuestNameByEmail('convidado@exemplo.ao');

    const sql = vi.mocked(query).mock.calls[0]?.[0] as string;

    expect(sql).toContain('i.claimed_at IS NOT NULL');
    expect(sql).toContain('i.claim_revoked_at IS NULL');
    expect(sql).toContain("now() - interval '30 days'");
    expect(sql).toContain('JOIN events e ON e.id = i.event_id');
  });
});
