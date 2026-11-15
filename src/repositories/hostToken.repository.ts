import { PoolClient } from 'pg';
import { pool } from '../database/pool';

/**
 * Tokens de uso único enviados por email.
 *
 * A base de dados guarda apenas o HMAC (`token_hash`). O token em
 * claro existe unicamente no link entregue ao anfitrião. O consumo é
 * atómico: `consumed_at IS NULL` impede que o mesmo link seja usado
 * duas vezes, mesmo em pedidos simultâneos.
 */
interface TokenRow {
  id: string;
  host_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export interface HostToken {
  id: string;
  hostId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

function toToken(row: TokenRow): HostToken {
  return {
    id: row.id,
    hostId: row.host_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

interface HostTokenRepository {
  create(
    hostId: string,
    tokenHash: string,
    expiresAt: Date,
    client?: PoolClient
  ): Promise<HostToken>;
  consume(tokenHash: string, client?: PoolClient): Promise<string | null>;
  consumeAllForHost(hostId: string, client?: PoolClient): Promise<number>;
}

function buildRepository(
  table: 'email_verifications' | 'password_resets'
): HostTokenRepository {
  return {
    async create(
      hostId: string,
      tokenHash: string,
      expiresAt: Date,
      client?: PoolClient
    ): Promise<HostToken> {
      const runner = client ?? pool;
      const result = await runner.query<TokenRow>(
        `INSERT INTO ${table} (host_id, token_hash, expires_at)
         VALUES ($1,$2,$3)
         RETURNING id, host_id, token_hash, expires_at, consumed_at, created_at`,
        [hostId, tokenHash, expiresAt]
      );

      const row = result.rows[0];
      if (!row) throw new Error(`Falha ao criar token em ${table}.`);
      return toToken(row);
    },

    /** Consome o token e devolve o `host_id`; `null` se inválido/expirado. */
    async consume(tokenHash: string, client?: PoolClient): Promise<string | null> {
      const runner = client ?? pool;
      const result = await runner.query<{ host_id: string }>(
        `UPDATE ${table}
            SET consumed_at = now()
          WHERE token_hash = $1
            AND consumed_at IS NULL
            AND expires_at > now()
          RETURNING host_id`,
        [tokenHash]
      );
      return result.rows[0]?.host_id ?? null;
    },

    /** Invalida todos os tokens pendentes de um anfitrião. */
    async consumeAllForHost(hostId: string, client?: PoolClient): Promise<number> {
      const runner = client ?? pool;
      const result = await runner.query(
        `UPDATE ${table}
            SET consumed_at = now()
          WHERE host_id = $1 AND consumed_at IS NULL`,
        [hostId]
      );
      return result.rowCount ?? 0;
    },
  };
}

export const emailVerificationRepository = buildRepository('email_verifications');
export const passwordResetRepository = buildRepository('password_resets');
