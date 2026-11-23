import { getZonedParts } from './date.util';

/** Fuso de referência para o cálculo da idade (produto opera em Angola). */
export const AGE_TIMEZONE = 'Africa/Luanda';

/**
 * Idade em anos completos de uma data de calendário `YYYY-MM-DD`,
 * calculada no fuso de Luanda. Devolve `null` para datas inválidas.
 */
export function ageFromBirthDate(
  birthDate: string,
  now: Date = new Date(),
  timeZone: string = AGE_TIMEZONE
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const today = getZonedParts(now, timeZone);

  let age = today.year - year;
  if (today.month < month || (today.month === month && today.day < day)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

/** Limites de idade do evento (internos, nunca expostos publicamente). */
export interface AgeLimits {
  minAge: number | null;
  maxAge: number | null;
}

export function hasAgeRestriction(limits: AgeLimits): boolean {
  return limits.minAge !== null || limits.maxAge !== null;
}

/** `true` quando a idade cumpre os limites (sem limites, cumpre sempre). */
export function ageWithinLimits(age: number, limits: AgeLimits): boolean {
  if (limits.minAge !== null && age < limits.minAge) return false;
  if (limits.maxAge !== null && age > limits.maxAge) return false;
  return true;
}
