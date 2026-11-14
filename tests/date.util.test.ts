import { describe, expect, it } from 'vitest';
import {
  buildReminderSchedule,
  formatDateTime,
  getZonedParts,
  isValidTimeZone,
  reminderScheduledFor,
  subtractDays,
  zonedTimeToUtc,
} from '../src/utils/date.util';

describe('date.util', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('subtrai dias preservando o instante', () => {
    const result = subtractDays(new Date('2026-02-01T10:00:00Z'), 7);
    expect(result.toISOString()).toBe('2026-01-25T10:00:00.000Z');
  });

  it('extrai componentes no fuso do evento', () => {
    const parts = getZonedParts(new Date('2027-08-15T18:00:00Z'), 'Africa/Luanda');
    expect(parts).toMatchObject({ year: 2027, month: 8, day: 15, hour: 19, minute: 0 });
  });

  it('converte hora de parede local em UTC', () => {
    const utc = zonedTimeToUtc(2027, 8, 15, 9, 0, 'Africa/Luanda');
    expect(utc.toISOString()).toBe('2027-08-15T08:00:00.000Z');
  });

  it('agenda os quatro marcos quando o evento está longe', () => {
    const startsAt = new Date('2027-03-01T18:00:00Z');
    const schedule = buildReminderSchedule(startsAt, 'Africa/Luanda', [14, 7, 3, 1], 9, now);

    expect(schedule.map((item) => item.kind)).toEqual(['14d', '7d', '3d', '1d']);
  });

  it('envia cada marco às 09:00 no fuso do evento', () => {
    const startsAt = new Date('2027-03-01T18:00:00Z');
    const oneDay = reminderScheduledFor(startsAt, 'Africa/Luanda', 1, 9);

    expect(oneDay.toISOString()).toBe('2027-02-28T08:00:00.000Z');
    expect(getZonedParts(oneDay, 'Africa/Luanda').hour).toBe(9);
  });

  it('ignora marcos cujo instante já passou', () => {
    const startsAt = new Date('2026-01-02T12:00:00Z');
    const schedule = buildReminderSchedule(startsAt, 'Africa/Luanda', [14, 7, 3, 1], 9, now);

    expect(schedule.map((item) => item.kind)).toEqual(['1d']);
  });

  it('ordena os marcos do mais próximo para o mais distante', () => {
    const startsAt = new Date('2027-03-01T18:00:00Z');
    const schedule = buildReminderSchedule(startsAt, 'Africa/Luanda', [1, 14, 3, 7], 9, now);

    for (let i = 1; i < schedule.length; i += 1) {
      const previous = schedule[i - 1];
      const current = schedule[i];
      expect(previous && current && previous.scheduledFor <= current.scheduledFor).toBe(true);
    }
  });

  it('não devolve marcos duplicados para offsets repetidos', () => {
    const startsAt = new Date('2027-03-01T18:00:00Z');
    const schedule = buildReminderSchedule(startsAt, 'Africa/Luanda', [7, 7], 9, now);

    expect(schedule).toHaveLength(2);
    expect(schedule[0]?.scheduledFor.getTime()).toBe(schedule[1]?.scheduledFor.getTime());
  });

  it('valida fusos horários', () => {
    expect(isValidTimeZone('Africa/Luanda')).toBe(true);
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('Fuso/Inventado')).toBe(false);
  });

  it('formata no fuso do evento', () => {
    const date = new Date('2027-08-15T18:00:00Z');
    expect(formatDateTime(date, 'Africa/Luanda')).toContain('15/08/2027');
  });
});
