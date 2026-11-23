import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { EventStatus } from '../types/event.types';
import { EventManager, HostEventManager } from '../types/eventManager.types';

interface EventManagerRow {
  id: string;
  event_id: string;
  team_id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  token_hash: string | null;
  token_expires_at: Date | null;
  access_code_hash: string | null;
  access_failed_count: number;
  access_locked_until: Date | null;
  link_expires_at: Date | null;
  link_revoked_at: Date | null;
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
    teamId: row.team_id,
    email: row.email,
    phone: row.phone,
    displayName: row.display_name,
    tokenHash: row.token_hash,
    tokenExpiresAt: row.token_expires_at,
    accessCodeHash: row.access_code_hash,
    accessFailedCount: row.access_failed_count,
    accessLockedUntil: row.access_locked_until,
    linkExpiresAt: row.link_expires_at,
    linkRevokedAt: row.link_revoked_at,
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
  m.id, m.event_id, m.team_id, m.email, m.phone, m.display_name,
  m.token_hash, m.token_expires_at, m.access_code_hash,
  m.access_failed_count, m.access_locked_until, m.link_expires_at,
  m.link_revoked_at, m.revoked_at, m.last_used_at, m.created_at, m.updated_at,
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
          AND e.deleted_at IS NULL
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
  async findActiveByTeam(
    teamId: string,
    client?: PoolClient
  ): Promise<EventManager | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `SELECT ${SELECT_WITH_ACCOUNT}
         FROM event_managers m
        WHERE m.team_id = $1
          AND m.revoked_at IS NULL
        LIMIT 1`,
      [teamId]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

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
      teamId: string;
      email: string | null;
      phone: string | null;
      displayName: string | null;
      tokenHash: string;
      tokenExpiresAt: Date;
      accessCodeHash: string | null;
      linkExpiresAt: Date;
    },
    client?: PoolClient
  ): Promise<EventManager> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH inserted AS (
         INSERT INTO event_managers (
           event_id, team_id, email, phone, display_name,
           token_hash, token_expires_at, access_code_hash, link_expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM inserted m`,
      [
        data.eventId,
        data.teamId,
        data.email,
        data.phone,
        data.displayName,
        data.tokenHash,
        data.tokenExpiresAt,
        data.accessCodeHash,
        data.linkExpiresAt,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar gestor do evento.');
    return toManager(row);
  },

  async reactivate(
    id: string,
    data: {
      teamId: string;
      email: string | null;
      phone: string | null;
      displayName: string | null;
      tokenHash: string;
      tokenExpiresAt: Date;
      accessCodeHash: string | null;
      linkExpiresAt: Date;
    },
    client?: PoolClient
  ): Promise<EventManager | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH updated AS (
         UPDATE event_managers
            SET revoked_at = NULL,
                link_revoked_at = NULL,
                team_id = $2,
                email = $3,
                phone = $4,
                display_name = $5,
                token_hash = $6,
                token_expires_at = $7,
                access_code_hash = $8,
                link_expires_at = $9,
                access_failed_count = 0,
                access_locked_until = NULL,
                updated_at = now()
          WHERE id = $1
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM updated m`,
      [
        id,
        data.teamId,
        data.email,
        data.phone,
        data.displayName,
        data.tokenHash,
        data.tokenExpiresAt,
        data.accessCodeHash,
        data.linkExpiresAt,
      ]
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
    data: {
      tokenHash: string;
      tokenExpiresAt: Date;
      accessCodeHash?: string | null;
      linkExpiresAt?: Date;
      resetFailures?: boolean;
    },
    client?: PoolClient
  ): Promise<EventManager | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH updated AS (
         UPDATE event_managers
            SET token_hash = $2,
                token_expires_at = $3,
                access_code_hash = COALESCE($4, access_code_hash),
                link_expires_at = COALESCE($5, link_expires_at),
                link_revoked_at = NULL,
                access_failed_count = CASE WHEN $6 THEN 0 ELSE access_failed_count END,
                access_locked_until = CASE WHEN $6 THEN NULL ELSE access_locked_until END,
                updated_at = now()
          WHERE id = $1
            AND revoked_at IS NULL
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM updated m`,
      [
        id,
        data.tokenHash,
        data.tokenExpiresAt,
        data.accessCodeHash ?? null,
        data.linkExpiresAt ?? null,
        data.resetFailures ?? false,
      ]
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
              link_revoked_at = now(),
              token_hash = NULL,
              token_expires_at = NULL,
              access_code_hash = NULL,
              access_failed_count = 0,
              access_locked_until = NULL,
              updated_at = now()
        WHERE id = $1
          AND revoked_at IS NULL`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Regista uma falha de código. A partir da 5.ª falha o link fica
   * bloqueado 15 minutos; na 15.ª é revogado. O motivo da revogação é
   * devolvido ao serviço para notificar o anfitrião.
   */
  async recordAccessFailure(
    id: string
  ): Promise<{ failedCount: number; lockedUntil: Date | null; revoked: boolean } | null> {
    const result = await query<{
      access_failed_count: number;
      access_locked_until: Date | null;
      link_revoked_at: Date | null;
    }>(
      `WITH updated AS (
         UPDATE event_managers
            SET access_failed_count = access_failed_count + 1,
                access_locked_until = CASE
                  WHEN access_failed_count + 1 >= 5
                    THEN now() + interval '15 minutes'
                  ELSE access_locked_until
                END,
                link_revoked_at = CASE
                  WHEN access_failed_count + 1 >= 15 THEN now()
                  ELSE link_revoked_at
                END,
                token_hash = CASE
                  WHEN access_failed_count + 1 >= 15 THEN NULL
                  ELSE token_hash
                END,
                access_code_hash = CASE
                  WHEN access_failed_count + 1 >= 15 THEN NULL
                  ELSE access_code_hash
                END,
                updated_at = now()
          WHERE id = $1
            AND revoked_at IS NULL
            AND link_revoked_at IS NULL
         RETURNING access_failed_count, access_locked_until, link_revoked_at
       )
       SELECT * FROM updated`,
      [id]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      failedCount: row.access_failed_count,
      lockedUntil: row.access_locked_until,
      revoked: row.link_revoked_at !== null,
    };
  },

  async recordSuccessfulAccess(id: string): Promise<void> {
    await query(
      `UPDATE event_managers
          SET access_failed_count = 0,
              access_locked_until = NULL,
              last_used_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [id]
    );
  },

  /** Revoga apenas o link, mantendo o gestor e a equipa. */
  async revokeLink(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE event_managers
          SET link_revoked_at = now(),
              token_hash = NULL,
              token_expires_at = NULL,
              access_code_hash = NULL,
              access_failed_count = 0,
              access_locked_until = NULL,
              updated_at = now()
        WHERE id = $1
          AND revoked_at IS NULL
          AND link_revoked_at IS NULL`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  },

  async updateAccessCodeHash(
    id: string,
    accessCodeHash: string,
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      'UPDATE event_managers SET access_code_hash = $2, updated_at = now() WHERE id = $1',
      [id, accessCodeHash]
    );
  },

  async updateLinkValidity(
    id: string,
    linkExpiresAt: Date,
    client?: PoolClient
  ): Promise<EventManager | null> {
    const runner = client ?? pool;
    const result = await runner.query<EventManagerRow>(
      `WITH updated AS (
         UPDATE event_managers
            SET link_expires_at = $2,
                token_expires_at = $2,
                updated_at = now()
          WHERE id = $1
            AND revoked_at IS NULL
            AND link_revoked_at IS NULL
         RETURNING *
       )
       SELECT ${SELECT_WITH_ACCOUNT} FROM updated m`,
      [id, linkExpiresAt]
    );

    const row = result.rows[0];
    return row ? toManager(row) : null;
  },

  async touch(id: string): Promise<void> {
    await query(
      'UPDATE event_managers SET last_used_at = now() WHERE id = $1',
      [id]
    );
  },
};
