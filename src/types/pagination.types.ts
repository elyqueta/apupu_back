/** Metadados de paginação devolvidos em todas as listas paginadas. */
export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}
