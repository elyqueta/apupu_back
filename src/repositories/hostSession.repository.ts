import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { EventAccessRole } from '../types/event.types';
import { HostSession } from '../types/hostSession.types';

interface HostSessionRow {
  id: string;
  event_id: string;
  token_hash: string;
  role: EventAccessRole;
  manager_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
}

function toSession(row: HostSessionRow): HostSession {
  return {
    id: row.id,
    eventId: row.event_id,
    tokenHash: row.token_hash,
    role: row.role,
    managerId: row.manager_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

const SELECT_COLUMNS = `
  id, event_id, token_hash, role, manager_id, expires_at, revoked_at,
  created_at, last_used_at
`;

export interface CreateHostSessionData {
  eventId: string;
  tokenHash: string;
  expiresAt: Date;
  /** `host` (por omissão) ou `manager`. */
  role?: EventAccessRole;
  managerId?: string | null;
}

export const hostSessionRepository = {
  async create(
    data: CreateHostSessionData,
    client?: PoolClient
  ): Promise<HostSession> {
    const runner = client ?? pool;
    const role = data.role ?? 'host';
    const managerId = role === 'manager' ? (data.managerId ?? null) : null;

    const result = await runner.query<HostSessionRow>(
      `INSERT INTO event_host_sessions (event_id, token_hash, expires_at, role, manager_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${SELECT_COLUMNS}`,
      [data.eventId, data.tokenHash, data.expiresAt, role, managerId]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar sessão de gestão.');
    return toSession(row);
  },

  /**
   * Devolve a sessão apenas se estiver ativa: não revogada e dentro
   * do prazo. A comparação é feita pelo hash do token, nunca pelo
   * valor em claro.
   */
  async findActiveByTokenHash(tokenHash: string): Promise<HostSession | null> {
    const result = await query<HostSessionRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM event_host_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? toSession(row) : null;
  },

  async touch(id: string): Promise<void> {
    await query('UPDATE event_host_sessions SET last_used_at = now() WHERE id = $1', [id]);
  },

  async revoke(id: string): Promise<void> {
    await query(
      'UPDATE event_host_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [id]
    );
  },

  async revokeAllForEvent(eventId: string): Promise<number> {
    const result = await query(
      `UPDATE event_host_sessions
          SET revoked_at = now()
        WHERE event_id = $1 AND revoked_at IS NULL`,
      [eventId]
    );
    return result.rowCount ?? 0;
  },

  /** Revoga todas as sessões emitidas para um gestor removido. */
  async revokeAllForManager(managerId: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE event_host_sessions
          SET revoked_at = now()
        WHERE manager_id = $1 AND revoked_at IS NULL`,
      [managerId]
    );
    return result.rowCount ?? 0;
  },
};
