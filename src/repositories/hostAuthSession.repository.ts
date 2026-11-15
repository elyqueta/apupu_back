import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { HostAuthSession } from '../types/host.types';

interface HostAuthSessionRow {
  id: string;
  host_id: string;
  token_hash: string;
  csrf_hash: string;
  user_agent_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

function toSession(row: HostAuthSessionRow): HostAuthSession {
  return {
    id: row.id,
    hostId: row.host_id,
    tokenHash: row.token_hash,
    csrfHash: row.csrf_hash,
    userAgentHash: row.user_agent_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `
  id, host_id, token_hash, csrf_hash, user_agent_hash,
  expires_at, revoked_at, last_used_at, created_at
`;

export const hostAuthSessionRepository = {
  async create(
    data: {
      hostId: string;
      tokenHash: string;
      csrfHash: string;
      userAgentHash: string | null;
      expiresAt: Date;
    },
    client?: PoolClient
  ): Promise<HostAuthSession> {
    const runner = client ?? pool;
    const result = await runner.query<HostAuthSessionRow>(
      `INSERT INTO host_auth_sessions (
         host_id, token_hash, csrf_hash, user_agent_hash, expires_at
       )
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.hostId,
        data.tokenHash,
        data.csrfHash,
        data.userAgentHash,
        data.expiresAt,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar sessão de conta.');
    return toSession(row);
  },

  /** Sessão ativa: não revogada e dentro do prazo. */
  async findActiveByTokenHash(tokenHash: string): Promise<HostAuthSession | null> {
    const result = await query<HostAuthSessionRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM host_auth_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? toSession(row) : null;
  },

  async touch(id: string): Promise<void> {
    await query(
      'UPDATE host_auth_sessions SET last_used_at = now() WHERE id = $1',
      [id]
    );
  },

  async revoke(id: string): Promise<void> {
    await query(
      `UPDATE host_auth_sessions
          SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL`,
      [id]
    );
  },

  /**
   * Revoga todas as sessões de uma conta. Usado na reposição de senha.
   * `exceptSessionId` permite manter a sessão que fez a alteração.
   */
  async revokeAllForHost(hostId: string, exceptSessionId?: string): Promise<number> {
    const result = await query(
      `UPDATE host_auth_sessions
          SET revoked_at = now()
        WHERE host_id = $1
          AND revoked_at IS NULL
          AND ($2::uuid IS NULL OR id <> $2)`,
      [hostId, exceptSessionId ?? null]
    );
    return result.rowCount ?? 0;
  },
};
