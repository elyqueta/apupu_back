/** Escapa `%`, `_` e `\` para uso em `ILIKE ... ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
