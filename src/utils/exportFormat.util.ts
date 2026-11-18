/**
 * Formatação partilhada pelos PDFs e CSVs exportados.
 *
 * Todas as datas são apresentadas no fuso de Angola (`Africa/Luanda`).
 * Os CSV seguem as regras do Excel/LibreOffice: UTF-8 com BOM, `;`,
 * CRLF, vírgula decimal e proteção contra fórmulas.
 */

export const EXPORT_TIME_ZONE = 'Africa/Luanda';

export type CsvValue = string | number | null | undefined;

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partsFor(
  date: Date,
  options: Intl.DateTimeFormatOptions
): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: EXPORT_TIME_ZONE,
    ...options,
  }).formatToParts(date);

  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
}

/** `AAAA-MM-DD HH:mm` no fuso `Africa/Luanda`. */
export function formatExportDateTime(value: Date | string | null | undefined): string {
  const date = asDate(value);
  if (!date) return '';

  const parts = partsFor(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** `22 nov 2026, 15:00` no fuso `Africa/Luanda`. */
export function formatDisplayDateTime(value: Date | string | null | undefined): string {
  const date = asDate(value);
  if (!date) return '';

  const day = new Intl.DateTimeFormat('pt-PT', {
    timeZone: EXPORT_TIME_ZONE,
    day: '2-digit',
  }).format(date);
  const month = new Intl.DateTimeFormat('pt-PT', {
    timeZone: EXPORT_TIME_ZONE,
    month: 'short',
  })
    .format(date)
    .replace(/\.$/, '');
  const year = new Intl.DateTimeFormat('pt-PT', {
    timeZone: EXPORT_TIME_ZONE,
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('pt-PT', {
    timeZone: EXPORT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  return `${day} ${month} ${year}, ${time}`;
}

/** Data de hoje no fuso de Angola, no formato `AAAA-MM-DD`. */
export function exportDateStamp(value: Date = new Date()): string {
  return formatExportDateTime(value).slice(0, 10);
}

/**
 * Número sem separador de milhares e com vírgula decimal.
 *
 * `12500` → `12500,00`; `12.5` → `12,50`.
 */
export function formatExportNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '';

  const fixed = Math.abs(value).toFixed(decimals);
  return `${value < 0 ? '-' : ''}${fixed.replace('.', ',')}`;
}

/** Valor monetário em kwanzas: `12 500,00 Kz`. */
export function formatKz(value: number): string {
  if (!Number.isFinite(value)) return '';

  const fixed = Math.abs(value).toFixed(2);
  const [integer, decimals] = fixed.split('.');
  const grouped = (integer ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '-' : ''}${grouped},${decimals} Kz`;
}

/**
 * Telemóvel angolano em `+244 9XX XXX XXX`.
 *
 * Números que não sejam móveis de 9 dígitos são devolvidos como vieram,
 * para não perder informação.
 */
export function formatAngolaPhone(value: string | null | undefined): string {
  if (!value) return '';

  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('244') ? digits.slice(3) : digits;

  if (/^9\d{8}$/.test(local)) {
    return `+244 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }

  return value.trim();
}

export const RSVP_STATUS_LABELS: Record<string, string> = {
  accepted: 'Confirmado',
  declined: 'Recusado',
  pending: 'Pendente',
};

export const SEND_STATUS_LABELS: Record<string, string> = {
  pending: 'Por enviar',
  queued: 'Em fila',
  sent: 'Enviado',
  failed: 'Falhou',
};

export const EVENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
};

export function rsvpStatusLabel(status: string): string {
  return RSVP_STATUS_LABELS[status] ?? status;
}

export function sendStatusLabel(status: string): string {
  return SEND_STATUS_LABELS[status] ?? status;
}

export function eventStatusLabel(status: string): string {
  return EVENT_STATUS_LABELS[status] ?? status;
}

/**
 * Prefixa com `'` os textos que o Excel interpretaria como fórmula.
 *
 * A regra cobre `=`, `+`, `-` e `@`, incluindo espaços/tabs iniciais.
 */
export function protectCsvFormula(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Célula CSV com aspas apenas quando necessário. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : formatExportNumber(value);
  }

  const safe = protectCsvFormula(String(value));
  const needsQuotes = /[;"\r\n]/.test(safe) || safe !== safe.trim();

  return needsQuotes ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Linha CSV com separador `;`. */
export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(';');
}

/** Cabeçalho CSV legível em pt-PT. */
export function csvHeader(labels: string[]): string {
  return csvRow(labels);
}

/** Conteúdo completo de um CSV pequeno, com BOM e CRLF. */
export function csvDocument(rows: string[]): Buffer {
  return Buffer.from(`\uFEFF${rows.join('\r\n')}\r\n`, 'utf8');
}

/** Slug estável para nomes de ficheiro. */
export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'evento'
  );
}

/** `conto-contigo_{tipo}_{slug}_{AAAA-MM-DD}.{ext}`. */
export function exportFilename(
  kind: string,
  eventTitle: string,
  generatedAt: Date,
  extension: 'pdf' | 'csv'
): string {
  return `conto-contigo_${kind}_${slugify(eventTitle)}_${exportDateStamp(generatedAt)}.${extension}`;
}

/** Código legível do documento, derivado do evento (sem sequência persistida). */
export function documentCode(prefix: string, eventId: string, generatedAt: Date): string {
  const year = exportDateStamp(generatedAt).slice(0, 4);
  const hex = eventId.replace(/-/g, '').slice(-8);
  const numeric = Number.parseInt(hex, 16);
  const sequence = Number.isFinite(numeric) ? numeric % 1_000_000 : 0;
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
