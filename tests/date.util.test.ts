import { describe, expect, it } from 'vitest';
import {
  buildReminderSchedule,
  formatDateTime,
  getZonedParts,
  isValidTimeZone,
  reminderScheduledFor,
  subtractDays,
  subtractMonths,
  zonedTimeToUtc,
} from '../src/utils/date.util';

describe('date.util', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('subtrai dias preservando o instante', () => {
    const result = subtractDays(new Date('2026-02-01T10:00:00Z'), 7);
    expect(result.toISOString()).toBe('2026-01-25T10:00:00.000Z');
  });

  it('subtrai meses preservando a hora e o fuso UTC', () => {
    const result = subtractMonths(new Date('2026-11-16T12:34:56.789Z'), 24);
    expect(result.toISOString()).toBe('2024-11-16T12:34:56.789Z');
  });

  it('fixa o dia ao último dia válido do mês de destino', () => {
    expect(subtractMonths(new Date('2024-03-31T00:00:00Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z'
    );
    expect(subtractMonths(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z'
    );
    expect(subtractMonths(new Date('2026-05-31T00:00:00Z'), 3).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z'
    );
  });

  it('atravessa a mudança de ano ao subtrair meses', () => {
    expect(subtractMonths(new Date('2026-01-15T09:00:00Z'), 1).toISOString()).toBe(
      '2025-12-15T09:00:00.000Z'
    );
    expect(subtractMonths(new Date('2026-02-28T09:00:00Z'), 24).toISOString()).toBe(
      '2024-02-28T09:00:00.000Z'
    );
  });

  it('rejeita meses negativos ou fraccionários', () => {
    const date = new Date('2026-11-16T00:00:00Z');
    expect(() => subtractMonths(date, -1)).toThrow(RangeError);
    expect(() => subtractMonths(date, 1.5)).toThrow(RangeError);
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
