import { describe, expect, it } from 'vitest';
import {
  buildPaginationMeta,
  paginationQueryFields,
  toPageParams,
} from '../src/utils/pagination.util';
import { z } from 'zod';

describe('paginação', () => {
  it('converte página e tamanho em offset e limite', () => {
    expect(toPageParams(1, 20)).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
      limit: 20,
    });

    expect(toPageParams(3, 15)).toEqual({
      page: 3,
      pageSize: 15,
      offset: 30,
      limit: 15,
    });
  });

  it('calcula total_pages com arredondamento para cima', () => {
    expect(buildPaginationMeta(0, 1, 20)).toEqual({
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
    });

    expect(buildPaginationMeta(21, 2, 10)).toEqual({
      page: 2,
      page_size: 10,
      total: 21,
      total_pages: 3,
    });
  });

  it('aplica defaults de página e tamanho', () => {
    const schema = z.object({ ...paginationQueryFields });
    expect(schema.parse({})).toEqual({ page: 1, page_size: 20 });
  });

  it('rejeita página inválida e tamanho acima de 100', () => {
    const schema = z.object({ ...paginationQueryFields });

    expect(schema.safeParse({ page: 0 }).success).toBe(false);
    expect(schema.safeParse({ page: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ page_size: 101 }).success).toBe(false);
    expect(schema.safeParse({ page_size: 100 }).success).toBe(true);
  });
});
