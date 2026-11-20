import { query } from '../database/pool';
import { ValidationError } from '../errors';
import { EventRecord } from '../types/event.types';

const DEFAULT_LINK_DAYS = 7;

/**
 * Validade controlada pelo anfitrião.
 *
 * O limite absoluto é calculado no Postgres para respeitar o fuso do
 * evento: sem `ends_at`, o evento termina no fim do dia de `starts_at`
 * nesse fuso. Nunca é possível ultrapassar esse limite + 1 dia.
 */
async function maximumExpiry(event: EventRecord): Promise<Date> {
  const result = await query<{ maximum_expiry: Date }>(
    `SELECT CASE
        WHEN $2::timestamptz IS NOT NULL THEN $2::timestamptz + interval '1 day'
        ELSE (
          (
            date_trunc('day', $1::timestamptz AT TIME ZONE $3) + interval '1 day'
          ) AT TIME ZONE $3
        ) + interval '1 day'
      END AS maximum_expiry`,
    [event.startsAt, event.endsAt, event.timezone]
  );

  const maximum = result.rows[0]?.maximum_expiry;
  if (!maximum) throw new Error('Falha ao calcular a validade máxima do link.');
  return maximum;
}

export const linkValidityService = {
  async maximumFor(event: EventRecord): Promise<Date> {
    return maximumExpiry(event);
  },

  /**
   * Resolve a data pedida. `null` usa o defeito de 7 dias. O valor
   * final é sempre limitado ao máximo permitido para o evento.
   */
  async resolve(event: EventRecord, requested?: Date | null): Promise<Date> {
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
