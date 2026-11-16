import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteInactiveBatch } = vi.hoisted(() => ({
  deleteInactiveBatch: vi.fn(),
}));

vi.mock('../src/database/pool', () => ({
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({}),
}));

vi.mock('../src/repositories/retention.repository', () => ({
  retentionRepository: { deleteInactiveBatch },
}));

import { retentionService } from '../src/services/retention.service';

describe('retentionService', () => {
  beforeEach(() => {
    deleteInactiveBatch.mockReset();
  });

  it('processa lotes até ao último incompleto e soma as contagens', async () => {
    deleteInactiveBatch
      .mockResolvedValueOnce({
        hostsDeleted: 2,
        eventsDetached: 3,
        verificationsDeleted: 1,
      })
      .mockResolvedValueOnce({
        hostsDeleted: 1,
        eventsDetached: 0,
        verificationsDeleted: 0,
      });

    const result = await retentionService.run({
      months: 24,
      batchSize: 2,
      now: new Date('2026-11-16T00:00:00Z'),
    });

    expect(deleteInactiveBatch).toHaveBeenCalledTimes(2);
    expect(deleteInactiveBatch.mock.calls[0]?.[0]).toEqual(
      new Date('2024-11-16T00:00:00Z')
    );
    expect(deleteInactiveBatch.mock.calls[0]?.[1]).toBe(2);
    expect(result).toMatchObject({
      months: 24,
      batch_size: 2,
      cutoff: '2024-11-16T00:00:00.000Z',
      batches: 2,
      hosts_deleted: 3,
      events_detached: 3,
      verifications_deleted: 1,
    });
  });

  it('termina quando não há contas inactivas', async () => {
    deleteInactiveBatch.mockResolvedValueOnce({
      hostsDeleted: 0,
      eventsDetached: 0,
      verificationsDeleted: 0,
    });

    const result = await retentionService.run({ months: 24, batchSize: 500 });

    expect(deleteInactiveBatch).toHaveBeenCalledTimes(1);
    expect(result.hosts_deleted).toBe(0);
    expect(result.events_detached).toBe(0);
    expect(result.batches).toBe(1);
  });

  it('usa os valores por omissão do ambiente', async () => {
    deleteInactiveBatch.mockResolvedValueOnce({
      hostsDeleted: 0,
      eventsDetached: 0,
      verificationsDeleted: 0,
    });

    const result = await retentionService.run();

    expect(result.months).toBe(24);
    expect(result.batch_size).toBe(500);
    expect(deleteInactiveBatch).toHaveBeenCalledTimes(1);
  });
});
