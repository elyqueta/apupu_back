import { Event, EventStatus } from '../types/event.types';
import { startOfNextDay } from './date.util';

const ACTIVE_STATUSES: EventStatus[] = ['scheduled', 'published'] as unknown as EventStatus[];

/**
 * Fim efetivo do evento (Bloco 15, Passo 1.4).
 *
 * - Com `endsAt`: usa `endsAt`.
 * - Sem `endsAt`: fim do dia de `startsAt` no fuso do evento (início do dia
 *   seguinte no fuso do evento).
 */
export function eventEndsAt(event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone'>): Date {
  if (event.endsAt) return event.endsAt;
  const timezone = event.timezone || 'Africa/Luanda';
  try {
    return startOfNextDay(event.startsAt, timezone);
  } catch {
    return startOfNextDay(event.startsAt, 'Africa/Luanda');
  }
}

/** Verdadeiro quando o fim efetivo do evento já passou. */
export function isEventPast(
  event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone' | 'status'>,
  now: Date = new Date()
): boolean {
  if (event.status === 'draft' || event.status === 'cancelled' || event.status === 'completed') {
    return event.status === 'completed';
  }
  return now.getTime() >= eventEndsAt(event).getTime();
}

/**
 * Estado efetivo derivado na leitura (nunca depender só do job).
 * `draft` e `cancelled` são explícitos; `scheduled/published` passam a
 * `completed` quando o fim efetivo já passou.
 */
export function effectiveEventStatus(
  event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone' | 'status'>,
  now: Date = new Date()
): EventStatus {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.status === 'draft') return 'draft';
  if (event.status === 'completed') return 'completed';
  return isEventPast(event, now) ? 'completed' : event.status;
}

/** Aplica o estado efetivo a um evento (cópia rasa). */
export function withEffectiveStatus<T extends Pick<Event, 'startsAt' | 'endsAt' | 'timezone' | 'status'>>(
  event: T,
  now: Date = new Date()
): T {
  const status = effectiveEventStatus(event, now);
  return status === event.status ? event : { ...event, status };
}

/**
 * Ordenação Bloco 15: ativos/futuros primeiro (startsAt asc), depois passados
 * (startsAt desc mais recentes primeiro?), depois cancelados (startsAt desc).
 * A spec diz "ativos/futuros primeiro (por data ascendente), depois passados,
 * depois cancelados".
 */
export function eventStatusGroup(status: EventStatus): number {
  if (status === 'cancelled') return 2;
  if (status === 'completed') return 1;
  return 0; // draft/scheduled/published ativos
}

export function compareEventsByBloco15Order<
  T extends Pick<Event, 'startsAt' | 'endsAt' | 'timezone' | 'status'>,
>(a: T, b: T, now: Date = new Date()): number {
  const sa = effectiveEventStatus(a, now);
  const sb = effectiveEventStatus(b, now);
  const ga = eventStatusGroup(sa);
  const gb = eventStatusGroup(sb);
  if (ga !== gb) return ga - gb;
  const ta = a.startsAt?.getTime() ?? 0;
  const tb = b.startsAt?.getTime() ?? 0;
  if (ga === 0) return ta - tb; // futuros/ativos asc
  return tb - ta; // passados/cancelados: mais recentes primeiro
}

export function isActiveStatus(status: EventStatus): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status);
}
