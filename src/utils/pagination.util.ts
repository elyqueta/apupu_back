import { z } from 'zod';
import { PaginationMeta } from '../types/pagination.types';

/**
 * Campos de paginação partilhados por todas as listas.
 *
 * A ordenação é sempre estável (`ORDER BY <sort>, id`): sem o
 * desempate pelo `id`, registos com a mesma data podiam aparecer em
 * páginas diferentes entre pedidos.
 */
export const paginationQueryFields = {
  page: z.coerce
    .number({ error: 'A página deve ser um número.' })
    .int('A página deve ser inteira.')
    .min(1, 'A página deve ser pelo menos 1.')
    .default(1),
  page_size: z.coerce
    .number({ error: 'O tamanho da página deve ser um número.' })
    .int('O tamanho da página deve ser inteiro.')
    .min(1, 'O tamanho da página deve ser pelo menos 1.')
    .max(100, 'O tamanho da página não pode exceder 100.')
    .default(20),
};

export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
}

export function toPageParams(page: number, pageSize: number): PageParams {
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number
): PaginationMeta {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

/** Ordenações permitidas em listas de eventos. */
export const EVENT_SORT_FIELDS = ['starts_at', 'created_at'] as const;
export type EventSortField = (typeof EVENT_SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
