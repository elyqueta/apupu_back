import { getZonedParts } from '../utils/date.util';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/**
 * Data curta usada em todas as mensagens: "sáb, 21 nov 2026".
 *
 * O `Intl` de pt-PT não devolve meses abreviados quando o dia é
 * numérico, por isso os componentes são montados a partir de
 * `getZonedParts`, que já respeita o fuso do evento.
 */
export function formatEmailDate(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();

  return `${WEEKDAYS[weekday] ?? ''}, ${parts.day} ${MONTHS[parts.month - 1] ?? ''} ${parts.year}`;
}

/** Hora curta usada em todas as mensagens: "15:00". */
export function formatEmailClock(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}
