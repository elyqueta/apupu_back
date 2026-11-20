import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { EventStatus } from '../types/event.types';
import { EventManager, HostEventManager } from '../types/eventManager.types';

interface EventManagerRow {
  id: string;
  event_id: string;
  email: string;
  token_hash: string | null;
  token_expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
  has_account: boolean;
}

interface HostEventManagerRow extends EventManagerRow {
  event_title: string;
  event_starts_at: Date | null;
  event_status: EventStatus;
}

function toManager(row: EventManagerRow): EventManager {
  return {
    id: row.id,
    eventId: row.event_id,
    email: row.email,
    tokenHash: row.token_hash,
    tokenExpiresAt: row.token_expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasAccount: row.has_account,
  };
}

/**
 * Colunas devolvidas em cada leitura.
 *
 * `has_account` é calculado a partir de `hosts` (email verificado) para
 * que o painel consiga distinguir um gestor que já tem conta de um que
 * só usa o link. O email é comparado sem distinguir maiúsculas porque
 * ambas as colunas são `citext`.
 */
const SELECT_WITH_ACCOUNT = `
  m.id, m.event_id, m.email, m.token_hash, m.token_expires_at,
  m.revoked_at, m.last_used_at, m.created_at, m.updated_at,
  EXISTS (
    SELECT 1
      FROM hosts h
     WHERE h.email = m.email
       AND h.email_verified_at IS NOT NULL
  ) AS has_account
`;

export const eventManagerRepository = {
  async listActiveByEvent(eventId: string): Promise<EventManager[]> {
    const result = await query<EventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT}
         FROM event_managers m
        WHERE m.event_id = $1
          AND m.revoked_at IS NULL
        ORDER BY m.created_at ASC, m.id ASC`,
      [eventId]
    );

    return result.rows.map(toManager);
  },

  /**
   * Lista todos os gestores activos dos eventos de um anfitrião.
   *
   * A página global de equipas mostra, numa só lista, quem gere cada
   * evento. Só os eventos cujo `host_id` é o da conta entram: eventos
   * em que a conta é apenas gestora não expõem a equipa.
   */
  async listActiveByHost(hostId: string): Promise<HostEventManager[]> {
    const result = await query<HostEventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT},
              e.title AS event_title,
              e.starts_at AS event_starts_at,
              e.status AS event_status
         FROM event_managers m
         JOIN events e ON e.id = m.event_id
        WHERE e.host_id = $1
          AND m.revoked_at IS NULL
        ORDER BY e.starts_at ASC NULLS LAST, e.created_at ASC, m.created_at ASC`,
      [hostId]
    );

    return result.rows.map((row) => ({
      ...toManager(row),
      eventTitle: row.event_title,
      eventStartsAt: row.event_starts_at,
      eventStatus: row.event_status,
    }));
  },

  async findById(id: string): Promise<EventManager | null> {
    const result = await query<EventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT} FROM event_managers m WHERE m.id = $1`,
      [id]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  async findActiveById(id: string): Promise<EventManager | null> {
    const result = await query<EventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT}
         FROM event_managers m
        WHERE m.id = $1
          AND m.revoked_at IS NULL`,
      [id]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  /**
   * Procura um gestor pelo hash do link. Devolve mesmo revogado/expirado
   * para que o serviço possa responder de forma genérica.
   */
  async findByTokenHash(tokenHash: string): Promise<EventManager | null> {
    const result = await query<EventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT}
         FROM event_managers m
        WHERE m.token_hash = $1`,
      [tokenHash]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  /** Lê o gestor com lock para reativar/rodar o token de forma atómica. */
  async findByEventAndEmailForUpdate(
    eventId: string,
    email: string,
    client: PoolClient
  ): Promise<EventManager | null> {
    const result = await client.query<EventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT}
         FROM event_managers m
        WHERE m.event_id = $1 AND m.email = $2
        FOR UPDATE`,
      [eventId, email]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  async create(
    data: {
      eventId: string;
      email: string;
      tokenHash: string;
      tokenExpiresAt: Date;
    },
    client?: PoolClient
  ): Promise<EventManager> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH inserted AS (
         INSERT INTO event_managers (event_id, email, token_hash, token_expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM inserted m`,
      [data.eventId, data.email, data.tokenHash, data.tokenExpiresAt]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar gestor do evento.');
    return toManager(row);
  },

  async reactivate(
    id: string,
    data: { tokenHash: string; tokenExpiresAt: Date },
    client?: PoolClient
  ): Promise<EventManager | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH updated AS (
         UPDATE event_managers
            SET revoked_at = NULL,
                token_hash = $2,
                token_expires_at = $3,
                updated_at = now()
          WHERE id = $1
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM updated m`,
      [id, data.tokenHash, data.tokenExpiresAt]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  /**
   * Garante que o email tem acesso activo ao evento.
   *
   * Usado quando um membro de equipa é promovido a gestor: cria a linha
   * em `event_managers` ou reactiva a existente, na mesma transação da
   * alteração de papel. O token fica nulo porque o acesso é pela conta
   * autenticada (comparação de email), não por link.
   */
  async ensureActiveForEmail(
    eventId: string,
    email: string,
    teamId: string,
    client?: PoolClient
  ): Promise<EventManager> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH upserted AS (
         INSERT INTO event_managers (event_id, team_id, email)
         VALUES ($1, $3, $2)
         ON CONFLICT (event_id, email)
         DO UPDATE SET team_id = $3, revoked_at = NULL, updated_at = now()
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM upserted m`,
      [eventId, email, teamId]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao garantir o acesso do gestor.');
    return toManager(row);
  },

  async rotateToken(
    id: string,
    data: { tokenHash: string; tokenExpiresAt: Date },
    client?: PoolClient
  ): Promise<EventManager | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH updated AS (
         UPDATE event_managers
            SET token_hash = $2,
                token_expires_at = $3,
                updated_at = now()
          WHERE id = $1
            AND revoked_at IS NULL
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM updated m`,
      [id, data.tokenHash, data.tokenExpiresAt]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  /**
   * Remove o acesso do gestor. O token é apagado (não apenas ignorado)
   * para que o link antigo deixe imediatamente de corresponder a
   * qualquer hash guardado.
   */
  async revoke(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE event_managers
          SET revoked_at = now(),
              token_hash = NULL,
              token_expires_at = NULL,
              updated_at = now()
        WHERE id = $1
          AND revoked_at IS NULL`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  },

  async touch(id: string): Promise<void> {
    await query(
      'UPDATE event_managers SET last_used_at = now() WHERE id = $1',
      [id]
    );
  },
};
