import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/pool', () => ({
  pool: {},
  query: vi.fn(),
}));

import { query } from '../src/database/pool';
import { adminAuditRepository } from '../src/repositories/adminAudit.repository';

/**
 * O `LIMIT` e o `OFFSET` são interpolados como `$n`. Se faltar um `$` na
 * interpolação, o número entra literal no SQL e o parâmetro corresponde
 * fica sem referência — o Postgres devolve 42P18 ("could not determine
 * data type of parameter $1"). Estes testes validam o alinhamento.
 */
function call(index: number): { sql: string; params: unknown[] } {
  const [sql, params] = vi.mocked(query).mock.calls[index] ?? [];
  return { sql: sql as string, params: (params ?? []) as unknown[] };
}

function expectPlaceholdersAligned(sql: string, params: unknown[]): void {
  const used = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const highest = used.length > 0 ? Math.max(...used) : 0;

  expect(highest).toBe(params.length);
  for (let position = 1; position <= highest; position += 1) {
    expect(used, `placeholder $${position} em "${sql}"`).toContain(position);
  }
}

describe('adminAuditRepository.list · placeholders de paginação', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
  });

  it('usa $1 e $2 para limit/offset quando não há filtros', async () => {
    const result = await adminAuditRepository.list({ limit: 20, offset: 0 });

    expect(result).toEqual({ items: [], total: 0 });
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);

    const items = call(0);
    expect(items.sql).toContain('ORDER BY a.created_at DESC LIMIT $1 OFFSET $2');
    expect(items.params).toEqual([20, 0]);
    expectPlaceholdersAligned(items.sql, items.params);

    const count = call(1);
    expect(count.sql).toContain('SELECT count(*)::text AS count');
    expect(count.sql).toContain('FROM admin_audit_log a');
    expect(count.params).toEqual([]);
    expectPlaceholdersAligned(count.sql, count.params);
  });

  it('desloca limit/offset quando há filtros', async () => {
    await adminAuditRepository.list({
      q: 'Ana',
      action: 'admin_support_listed',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
      limit: 10,
      offset: 30,
    });

    const items = call(0);
    expect(items.sql).toContain('a.action ILIKE $1');
    expect(items.sql).toContain('a.action = $2');
    expect(items.sql).toContain('a.created_at >= $3');
    expect(items.sql).toContain('a.created_at <= $4');
    expect(items.sql).toContain('LIMIT $5 OFFSET $6');
    expect(items.params).toEqual([
      '%Ana%',
      'admin_support_listed',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
      10,
      30,
    ]);
    expectPlaceholdersAligned(items.sql, items.params);

    const count = call(1);
    expect(count.sql).toContain('a.action ILIKE $1');
    expect(count.params).toHaveLength(4);
    expectPlaceholdersAligned(count.sql, count.params);
  });
});

describe('adminAuditRepository · identidade do autor', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
  });

  function row() {
    return {
      id: 'log-1',
      admin_id: 'admin-1',
      admin_email: 'admin@exemplo.ao',
      admin_name: 'Admin Geral',
      action: 'admin_all_users_report_exported',
      target_type: 'admin',
      target_id: 'admin-1',
      reason: null,
      metadata: {},
      created_at: new Date('2026-11-20T15:00:00Z'),
    };
  }

  it('devolve email e nome do admin na atividade recente', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [row()] } as never);

    const [entry] = await adminAuditRepository.recent(10);

    expect(entry.adminEmail).toBe('admin@exemplo.ao');
    expect(entry.adminName).toBe('Admin Geral');
    expect(call(0).sql).toContain('LEFT JOIN host_profiles p ON p.host_id = h.id');
  });

  it('devolve email e nome do admin na lista paginada', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [row()] } as never);

    const { items } = await adminAuditRepository.list({ limit: 10, offset: 0 });

    expect(items[0].adminEmail).toBe('admin@exemplo.ao');
    expect(items[0].adminName).toBe('Admin Geral');
  });
});
