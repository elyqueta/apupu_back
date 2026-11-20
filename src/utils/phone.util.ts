/**
 * Normalização de telefones angolanos para E.164.
 *
 * Aceita escrita livre (`923 456 789`, `(923) 456-789`, `+244 923...`)
 * e devolve sempre `+2449xxxxxxxx`. Outros indicativos são rejeitados
 * porque o produto opera apenas em Angola.
 */
export function normalizeAngolanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  if (digits.startsWith('244')) {
    const national = digits.slice(3);
    return /^[2-9]\d{8}$/.test(national) ? `+244${national}` : null;
  }

  const national = digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[2-9]\d{8}$/.test(national) ? `+244${national}` : null;
}
