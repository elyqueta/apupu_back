import { query } from '../database/pool';
import { ValidationError } from '../errors';
import { Event } from '../types/event.types';

const DEFAULT_LINK_DAYS = 7;
const INVITATION_MAX_DAYS_AFTER_EVENT = 30;

/**
 * Validade controlada pelo anfitrião.
 *
 * O limite absoluto é calculado no Postgres para respeitar o fuso do
 * evento: sem `ends_at`, o evento termina no fim do dia de `starts_at`
 * nesse fuso. Nunca é possível ultrapassar esse limite + 1 dia.
 */
async function maximumExpiry(
  event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone'>,
  daysAfterEvent = 1
): Promise<Date> {
  const result = await query<{ maximum_expiry: Date }>(
    `SELECT CASE
        WHEN $2::timestamptz IS NOT NULL THEN $2::timestamptz + ($4::int || ' days')::interval
        ELSE (
          (
            date_trunc('day', $1::timestamptz AT TIME ZONE $3) + interval '1 day'
          ) AT TIME ZONE $3
        ) + ($4::int || ' days')::interval
      END AS maximum_expiry`,
    [event.startsAt, event.endsAt, event.timezone, daysAfterEvent]
  );

  const maximum = result.rows[0]?.maximum_expiry;
  if (!maximum) throw new Error('Falha ao calcular a validade máxima do link.');
  return maximum;
}

export const linkValidityService = {
  async maximumFor(event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone'>): Promise<Date> {
    return maximumExpiry(event);
  },

  /** Limite do link do convite: fim do evento + 30 dias. */
  async maximumInvitationFor(
    event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone'>
  ): Promise<Date> {
    return maximumExpiry(event, INVITATION_MAX_DAYS_AFTER_EVENT);
  },

  /** Valida a nova validade pedida para o link do convite. */
  async resolveInvitationExpiry(
    event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone'>,
    requested: Date
  ): Promise<Date> {
    if (requested.getTime() <= Date.now()) {
      throw new ValidationError('Verifique os campos indicados.', {
        expires_at: ['A validade deve ser no futuro.'],
      });
    }
    const maximum = await maximumExpiry(event, INVITATION_MAX_DAYS_AFTER_EVENT);
    if (requested.getTime() > maximum.getTime()) {
      throw new ValidationError('Verifique os campos indicados.', {
        expires_at: ['A validade ultrapassa o máximo permitido para o evento.'],
      });
    }
    return requested;
  },

  /**
   * Resolve a data pedida. `null` usa o defeito de 7 dias. O valor
   * final é sempre limitado ao máximo permitido para o evento.
   */
  async resolve(
    event: Pick<Event, 'startsAt' | 'endsAt' | 'timezone'>,
    requested?: Date | null
  ): Promise<Date> {
    const maximum = await maximumExpiry(event);
    const now = Date.now();
    const fallback = new Date(Math.min(now + DEFAULT_LINK_DAYS * 86_400_000, maximum.getTime()));

    if (!requested) {
      return fallback.getTime() > now ? fallback : new Date(now + 86_400_000);
    }

    if (requested.getTime() <= now) {
      throw new ValidationError('Verifique os campos indicados.', {
        link_expires_at: ['A validade deve ser no futuro.'],
      });
    }

    if (requested.getTime() > maximum.getTime()) {
      throw new ValidationError('Verifique os campos indicados.', {
        link_expires_at: ['A validade ultrapassa o máximo permitido para o evento.'],
      });
    }

    return requested;
  },
};
