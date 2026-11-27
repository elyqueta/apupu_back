import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { eventRepository, type InsertEventData } from '../src/repositories/event.repository';

/**
 * O INSERT de eventos tem muitos campos; um placeholder a menos provoca o
 * erro "INSERT has more target columns than expressions" apenas em runtime.
 */
describe('eventRepository.create', () => {
  it('tem um placeholder por coluna e um parâmetro por placeholder', async () => {
    let sql = '';
    let params: unknown[] = [];
    const client = {
      query: async (query: string, values?: unknown[]) => {
        sql = query;
        params = values ?? [];
        return { rows: [{}] };
      },
    } as unknown as PoolClient;

    const data = {
      hostId: 'host-1',
      manageTokenHash: 'hash',
      manageTokenExpiresAt: new Date(),
      title: 'Evento',
      hostName: 'Anfitrião',
      hostEmail: 'host@example.com',
      category: null,
      startsAt: new Date(),
      endsAt: null,
      timezone: 'Africa/Luanda',
      location: {
        type: 'physical',
        name: 'Sede',
        address: 'Luanda',
        onlineUrl: null,
        latitude: null,
        longitude: null,
        placeLabel: null,
        placeName: null,
      },
      message: null,
      rules: null,
      dressCode: null,
      templateId: null,
      theme: {},
      contribution: {
        enabled: false,
        bankName: null,
        accountHolder: null,
        accountReference: null,
      },
      rsvpDeadline: null,
      coverUrl: null,
      visibility: 'private',
      publicSlug: null,
      showAttendeeCount: false,
      minAge: null,
      maxAge: null,
      communityId: null,
      youtubeVideoId: null,
      useTables: false,
    } as unknown as InsertEventData;

    await eventRepository.create(data, client);

    const columns = sql.match(/INSERT INTO events \(([^)]+)\)/)?.[1] ?? '';
    const values = sql.match(/VALUES \(([^)]+)\)/)?.[1] ?? '';
    const columnNames = columns.split(',').map((column) => column.trim());
    const expressions = values.split(',').map((value) => value.trim());
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));

    expect(columnNames).toContain('use_tables');
    expect(expressions).toHaveLength(columnNames.length);
    expect(new Set(placeholders).size).toBe(params.length);
    expect(Math.max(...placeholders)).toBe(params.length);
  });
});
