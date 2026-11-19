const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Extrai os componentes de uma data no fuso indicado. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Converte uma hora de parede local num instante UTC.
 *
 * Não usamos bibliotecas externas: `Intl` já conhece a base de dados
 * IANA do runtime. O algoritmo parte de uma estimativa UTC e corrige-a
 * com o offset observado, iterando até estabilizar (duas iterações
 * bastam na maioria dos fusos; usamos quatro por segurança).
 *
 * Em transições DST, uma hora inexistente é deslocada para o instante
 * válido mais próximo e uma hora ambígua resolve-se de forma
 * determinística — nunca duplicando nem perdendo entregas.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let timestamp = targetAsUtc;

  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(new Date(timestamp), timeZone);
    const observedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const offset = observedAsUtc - timestamp;
    const corrected = targetAsUtc - offset;

    if (corrected === timestamp) break;
    timestamp = corrected;
  }

  return new Date(timestamp);
}

/**
 * Uma hora de parede do dia seguinte no fuso indicado.
 *
 * Usa o calendário local para não depender da duração em milissegundos
 * (DST). É a base da regra de encerramento de eventos sem `ends_at`.
 */
export function nextDayAt(date: Date, timeZone: string, hour: number, minute = 0): Date {
  const parts = getZonedParts(date, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day + 1, hour, minute, timeZone);
}

/** Início do dia seguinte no fuso indicado (00:00 local). */
export function startOfNextDay(date: Date, timeZone: string): Date {
  return nextDayAt(date, timeZone, 0);
}

/** Formata uma data no fuso horário do evento. */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'full',
    timeStyle: 'short',
  }
): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-PT', { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** Data/hora legível e curta, ex.: "15/08/2026, 19:00". */
export function formatDateTime(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Subtrai dias inteiros a um instante, preservando o instante. */
export function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * MS_PER_DAY);
}

/**
 * Subtrai meses de calendário em UTC, preservando a hora.
 *
 * O dia é fixado ao último dia válido do mês de destino: por exemplo,
 * 31 de Março menos um mês resulta em 28 ou 29 de Fevereiro, nunca em
 * 3 de Março. Usado pela retenção de contas, onde a diferença de um
 * dia não pode antecipar ou atrasar a eliminação.
 */
export function subtractMonths(date: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError('months deve ser um inteiro não negativo.');
  }

  const result = new Date(date.getTime());
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);

  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();

  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Verdadeiro se `date` ainda está no futuro relativamente a `now`. */
export function isFuture(date: Date, now: Date = new Date()): boolean {
  return date.getTime() > now.getTime();
}

/** Etiqueta estável usada na base de dados: "14d", "7d", "3d", "1d". */
export function reminderKind(offsetDays: number): string {
  return `${offsetDays}d`;
}

/**
 * Instante de envio de um marco: `offsetDays` dias antes do início,
 * às `localHour` no fuso do evento (por omissão 09:00).
 */
export function reminderScheduledFor(
  startsAt: Date,
  timeZone: string,
  offsetDays: number,
  localHour: number
): Date {
  const start = getZonedParts(startsAt, timeZone);

  // Subtrai dias no calendário local, não em milissegundos: isto
  // mantém a data correta mesmo quando há mudança de hora.
  const localDate = new Date(Date.UTC(start.year, start.month - 1, start.day));
  localDate.setUTCDate(localDate.getUTCDate() - offsetDays);

  return zonedTimeToUtc(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
    localHour,
    0,
    timeZone
  );
}

/**
 * Calcula os lembretes de um evento.
 *
 * A cadência é expressa em dias antes do início e enviada à hora
 * local configurada. Marcos cujo instante já passou não são criados:
 * um evento criado depois de T-14 não recebe retroativamente os
 * lembretes perdidos.
 */
export function buildReminderSchedule(
  startsAt: Date,
  timeZone: string,
  offsetsDays: number[],
  localHour: number,
  now: Date = new Date()
): Array<{ kind: string; scheduledFor: Date }> {
  return offsetsDays
    .map((offset) => ({
      kind: reminderKind(offset),
      scheduledFor: reminderScheduledFor(startsAt, timeZone, offset, localHour),
    }))
    .filter((reminder) => isFuture(reminder.scheduledFor, now))
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

/**
 * Verdadeiro se `value` é uma data de calendário real no formato
 * `YYYY-MM-DD`. Rejeita 2026-02-30 e datas com hora.
 */
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Idade completa em anos, comparando datas de calendário em UTC. */
export function ageInYears(birthDate: string, now: Date = new Date()): number {
  const parts = birthDate.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month ||
    (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);

  if (beforeBirthday) age -= 1;
  return age;
}

/** Verdadeiro se o fuso informado é aceite pelo runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-PT', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
