import { PoolClient } from 'pg';
import { pool } from '../database/pool';
import { TeamInvite, TeamInviteContext, TeamMemberStatus } from '../types/team.types';

/**
 * Convites de equipa por email.
 *
 * A tabela guarda apenas o HMAC do token. O token em claro é cifrado
 * na outbox (`email_deliveries.token_encrypted`) e reconstruído no
 * worker imediatamente antes do envio. A aceitação é atómica:
 * `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`
 * impede a reutilização do mesmo link, mesmo em pedidos simultâneos.
 */
interface TeamInviteRow {
  id: string;
  member_id: string;
  team_id: string;
  email: string;
  created_by_host_id: string | null;
  token_hash: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  send_count: number;
  last_sent_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface TeamInviteContextRow extends TeamInviteRow {
  team_name: string;
  event_id: string;
  event_title: string;
  inviter_name: string | null;
  member_display_name: string | null;
  member_host_id: string | null;
  member_status: TeamMemberStatus;
  member_removed_at: Date | null;
}

function toInvite(row: TeamInviteRow): TeamInvite {
  return {
    id: row.id,
    memberId: row.member_id,
    teamId: row.team_id,
    email: row.email,
    createdByHostId: row.created_by_host_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    sendCount: row.send_count,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toContext(row: TeamInviteContextRow): TeamInviteContext {
  return {
    ...toInvite(row),
    teamName: row.team_name,
    eventId: row.event_id,
    eventTitle: row.event_title,
    inviterName: row.inviter_name,
    memberDisplayName: row.member_display_name,
    memberHostId: row.member_host_id,
    memberStatus: row.member_status,
    memberRemovedAt: row.member_removed_at,
  };
}

const INVITE_COLUMNS = `
  id, member_id, team_id, email, created_by_host_id, token_hash, expires_at,
  accepted_at, revoked_at, send_count, last_sent_at,
  created_at, updated_at
`;

const SELECT_INVITE = `
  ti.id, ti.member_id, ti.team_id, ti.email, ti.created_by_host_id,
  ti.token_hash, ti.expires_at,
  ti.accepted_at, ti.revoked_at, ti.send_count, ti.last_sent_at,
  ti.created_at, ti.updated_at
`;

const SELECT_CONTEXT = `
  ${SELECT_INVITE},
  t.name             AS team_name,
  t.event_id         AS event_id,
  e.title            AS event_title,
  COALESCE(hp.display_name, h.email) AS inviter_name,
  m.display_name     AS member_display_name,
  m.host_id          AS member_host_id,
  m.status           AS member_status,
  m.removed_at       AS member_removed_at
`;

const FROM_CONTEXT = `
  FROM team_invites ti
  JOIN teams t ON t.id = ti.team_id AND t.deleted_at IS NULL
  JOIN events e ON e.id = t.event_id
  JOIN team_members m ON m.id = ti.member_id
  LEFT JOIN hosts h ON h.id = ti.created_by_host_id
  LEFT JOIN host_profiles hp ON hp.host_id = h.id
`;

export const teamInviteRepository = {
  async create(
    data: {
      memberId: string;
      teamId: string;
      email: string;
      createdByHostId: string | null;
      tokenHash: string;
      expiresAt: Date;
    },
    client?: PoolClient
  ): Promise<TeamInvite> {
    const runner = client ?? pool;
    const result = await runner.query<TeamInviteRow>(
      `INSERT INTO team_invites (
         member_id, team_id, email, created_by_host_id, token_hash, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${INVITE_COLUMNS}`,
      [
        data.memberId,
        data.teamId,
        data.email,
        data.createdByHostId,
        data.tokenHash,
        data.expiresAt,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar convite de equipa.');
    return toInvite(row);
  },

  async findById(id: string, client?: PoolClient): Promise<TeamInvite | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamInviteRow>(
      `SELECT ${SELECT_INVITE} FROM team_invites ti WHERE ti.id = $1`,
      [id]
    );

    const row = result.rows[0];
    return row ? toInvite(row) : null;
  },

  async findActiveByMemberId(
    memberId: string,
    client?: PoolClient
  ): Promise<TeamInvite | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamInviteRow>(
      `SELECT ${SELECT_INVITE}
         FROM team_invites ti
        WHERE ti.member_id = $1
          AND ti.accepted_at IS NULL
          AND ti.revoked_at IS NULL
        ORDER BY ti.created_at DESC
        LIMIT 1`,
      [memberId]
    );

    const row = result.rows[0];
    return row ? toInvite(row) : null;
  },

  /** Lê o convite e o contexto (equipa, evento e membro) pelo hash. */
  async findByTokenHash(
    tokenHash: string,
    client?: PoolClient
  ): Promise<TeamInviteContext | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamInviteContextRow>(
      `SELECT ${SELECT_CONTEXT}
       ${FROM_CONTEXT}
        WHERE ti.token_hash = $1`,
      [tokenHash]
    );

    const row = result.rows[0];
    return row ? toContext(row) : null;
  },

  /** Lê o convite e o contexto com lock para aceitar de forma atómica. */
  async findByTokenHashForUpdate(
    tokenHash: string,
    client: PoolClient
  ): Promise<TeamInviteContext | null> {
    const result = await client.query<TeamInviteContextRow>(
      `SELECT ${SELECT_CONTEXT}
       ${FROM_CONTEXT}
        WHERE ti.token_hash = $1
        FOR UPDATE OF ti`,
      [tokenHash]
    );

    const row = result.rows[0];
    return row ? toContext(row) : null;
  },

  /**
   * Marca o convite como aceite. Só uma chamada concorrente consegue:
   * as restantes vêem `rowCount = 0`.
   */
  async accept(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE team_invites
          SET accepted_at = now(), updated_at = now()
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  },

  async revokeActiveForMember(memberId: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE team_invites
          SET revoked_at = now(), updated_at = now()
        WHERE member_id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL`,
      [memberId]
    );

    return result.rowCount ?? 0;
  },

  /**
   * Rotaciona o token de um convite activo para reenvio.
   *
   * O token anterior deixa de corresponder ao hash guardado, pelo que
   * o link antigo fica imediatamente inválido.
   */
  async rotate(
    id: string,
    data: { tokenHash: string; expiresAt: Date },
    client?: PoolClient
  ): Promise<TeamInvite | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamInviteRow>(
      `UPDATE team_invites
          SET token_hash = $2,
              expires_at = $3,
              send_count = send_count + 1,
              last_sent_at = now(),
              updated_at = now()
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
       RETURNING ${INVITE_COLUMNS}`,
      [id, data.tokenHash, data.expiresAt]
    );

    const row = result.rows[0];
    return row ? toInvite(row) : null;
  },

  /** Conta convites criados para o mesmo email desde `since`. */
  async countRecentByEmail(
    email: string,
    since: Date,
    client?: PoolClient
  ): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM team_invites
        WHERE email = $1
          AND created_at >= $2`,
      [email, since]
    );

    return Number(result.rows[0]?.total ?? '0');
  },

  /** Conta convites criados por um anfitrião desde `since`. */
  async countRecentByHost(
    hostId: string,
    since: Date,
    client?: PoolClient
  ): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM team_invites
        WHERE created_by_host_id = $1
          AND created_at >= $2`,
      [hostId, since]
    );

    return Number(result.rows[0]?.total ?? '0');
  },

  /**
   * `true` quando o anfitrião foi denunciado por aquele email.
   *
   * A denúncia é sempre por par (anfitrião, email): o mesmo email pode
   * continuar a receber convites de outros anfitriões.
   */
  async isBlocked(hostId: string, email: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM team_invite_blocks
          WHERE host_id = $1
            AND email = $2::citext
       ) AS blocked`,
      [hostId, email]
    );

    return result.rows[0]?.blocked === true;
  },

  /** Regista a denúncia, sem duplicar o par (anfitrião, email). */
  async block(
    hostId: string,
    email: string,
    reason: string,
    client?: PoolClient
  ): Promise<void> {
    const runner = client ?? pool;
    await runner.query(
      `INSERT INTO team_invite_blocks (host_id, email, reason)
       VALUES ($1, $2::citext, $3)
       ON CONFLICT (host_id, email) DO UPDATE
         SET reason = EXCLUDED.reason,
             updated_at = now()`,
      [hostId, email, reason]
    );
  },
};

export type { TeamInvite };
