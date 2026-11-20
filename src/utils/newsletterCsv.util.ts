import { NewsletterSubscription } from '../types/newsletter.types';
import { protectCsvFormula } from './exportFormat.util';

/**
 * CSV da exportação de novidades.
 *
 * O contrato fixa o cabeçalho `email,created_at` (separador por vírgula,
 * sem BOM). Antes de citar a célula, valores que o Excel interpretaria
 * como fórmula recebem um `'` à frente; aspas duplas são duplicadas.
 */
export function csvField(value: string): string {
  const safe = protectCsvFormula(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

export function newsletterCsv(subscriptions: NewsletterSubscription[]): string {
  const lines = ['email,created_at'];
  for (const subscription of subscriptions) {
    lines.push(`${csvField(subscription.email)},${csvField(subscription.createdAt.toISOString())}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}
