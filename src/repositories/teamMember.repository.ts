import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  TeamMember,
  TeamMemberOrigin,
  TeamMemberRole,
  TeamMemberStatus,
  TeamMemberWithStats,
} from '../types/team.types';

interface TeamMemberRow {
  id: string;
  team_id: string;
  host_id: string | null;
  email: string;
  display_name: string | null;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  origin: TeamMemberOrigin;
  is_host: boolean;
  invited_by_host_id: string | null;
  joined_at: Date | null;
  removed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  open_task_count: number;
  has_event_access: boolean;
}

function toMember(row: TeamMemberRow): TeamMemberWithStats {
  return {
    id: row.id,
    teamId: row.team_id,
    hostId: row.host_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    origin: row.origin,
    isHost: row.is_host,
    invitedByHostId: row.invited_by_host_id,
    joinedAt: row.joined_at,
    removedAt: row.removed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openTaskCount: row.open_task_count,
    hasEventAccess: row.has_event_access,
  };
}

const SELECT_MEMBER = `
  m.id, m.team_id, m.host_id, m.email, m.display_name, m.role,
  m.status, m.origin, m.is_host, m.invited_by_host_id, m.joined_at,
  m.removed_at, m.created_at, m.updated_at,
  COALESCE(open.open_task_count, 0)::int AS open_task_count,
  CASE
    WHEN m.removed_at IS NOT NULL THEN false
    WHEN m.is_host THEN true
    WHEN m.role = 'gestor' THEN EXISTS (
      SELECT 1
        FROM event_managers em
       WHERE em.event_id = e.id
         AND em.email = m.email
         AND em.revoked_at IS NULL
    )
    ELSE true
  END AS has_event_access
`;

const FROM_MEMBER = `
  FROM team_members m
  JOIN teams t ON t.id = m.team_id
  JOIN events e ON e.id = t.event_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS open_task_count
      FROM host_tasks ht
     WHERE ht.assignee_member_id = m.id
       AND ht.status <> 'concluida'
       AND ht.archived_at IS NULL
  ) open ON true
`;

export interface CreateTeamMemberData {
  teamId: string;
  hostId: string | null;
  email: string;
  displayName: string | null;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  origin: TeamMemberOrigin;
  isHost: boolean;
  invitedByHostId: string | null;
  joinedAt: Date | null;
}

export interface TeamMemberListFilters {
  role?: TeamMemberRole;
  status?: TeamMemberStatus;
  q?: string;
  offset: number;
  limit: number;
}

export const teamMemberRepository = {
  async create(data: CreateTeamMemberData, client?: PoolClient): Promise<TeamMemberWithStats> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `INSERT INTO team_members (
         team_id, host_id, email, display_name, role, status, origin,
         is_host, invited_by_host_id, joined_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        data.teamId,
        data.hostId,
        data.email,
        data.displayName,
        data.role,
        data.status,
        data.origin,
        data.isHost,
        data.invitedByHostId,
        data.joinedAt,
      ]
    );

    const id = result.rows[0]?.id;
    if (!id) throw new Error('Falha ao adicionar membro.');

    const member = await this.findById(id, client);
    if (!member) throw new Error('Falha ao ler o membro criado.');
    return member;
  },

  async findById(id: string, client?: PoolClient): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER} ${FROM_MEMBER} WHERE m.id = $1`,
      [id]
    );

    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async findByIdForUpdate(
    id: string,
    client: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const result = await client.query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER} ${FROM_MEMBER}
        WHERE m.id = $1
        FOR UPDATE OF m`,
      [id]
    );

    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async findActiveByTeamAndEmail(
    teamId: string,
    email: string,
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER} ${FROM_MEMBER}
        WHERE m.team_id = $1
          AND m.email = $2::citext
          AND m.removed_at IS NULL`,
      [teamId, email]
    );

    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async findRemovedByTeamAndEmail(
    teamId: string,
    email: string,
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER} ${FROM_MEMBER}
        WHERE m.team_id = $1
          AND m.email = $2::citext
          AND m.removed_at IS NOT NULL
        ORDER BY m.removed_at DESC
        LIMIT 1`,
      [teamId, email]
    );

    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async findActiveByEmailInTeam(
    teamId: string,
    email: string,
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    return this.findActiveByTeamAndEmail(teamId, email, client);
  },

  async findActiveByEmailInEvent(
    eventId: string,
    email: string,
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER} ${FROM_MEMBER}
        WHERE t.event_id = $1
          AND m.email = $2::citext
          AND m.removed_at IS NULL
        ORDER BY m.is_host DESC, m.created_at ASC, m.id ASC
        LIMIT 1`,
      [eventId, email]
    );

    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async existsActiveInEvent(
    eventId: string,
    email: string,
    client?: PoolClient
  ): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM team_members m
           JOIN teams t ON t.id = m.team_id
          WHERE t.event_id = $1
            AND t.deleted_at IS NULL
            AND m.email = $2::citext
            AND m.removed_at IS NULL
       ) AS exists`,
      [eventId, email]
    );

    return result.rows[0]?.exists ?? false;
  },

  async findHostMember(
    teamId: string,
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER} ${FROM_MEMBER}
        WHERE m.team_id = $1
          AND m.is_host
          AND m.removed_at IS NULL
        LIMIT 1`,
      [teamId]
    );

    const row = result.rows[0];
    return row ? toMember(row) : null;
  },

  async listForTeam(
    teamId: string,
    filters: TeamMemberListFilters
  ): Promise<{ items: TeamMemberWithStats[]; total: number }> {
    const values: unknown[] = [teamId];
    const conditions = ['m.team_id = $1', 'm.removed_at IS NULL'];

    if (filters.role) {
      values.push(filters.role);
      conditions.push(`m.role = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`m.status = $${values.length}`);
    }
    if (filters.q) {
      values.push(`%${filters.q}%`);
      conditions.push(
        `(m.display_name ILIKE $${values.length} OR m.email ILIKE $${values.length})`
      );
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM team_members m
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<TeamMemberRow>(
      `SELECT ${SELECT_MEMBER}
       ${FROM_MEMBER}
        WHERE ${where}
        ORDER BY m.is_host DESC, m.role ASC, m.created_at ASC, m.id ASC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toMember),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async updateRole(
    id: string,
    role: TeamMemberRole,
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE team_members
          SET role = $2, updated_at = now()
        WHERE id = $1
          AND removed_at IS NULL`,
      [id, role]
    );

    return this.findById(id, client);
  },

  async reactivate(
    id: string,
    data: {
      hostId: string | null;
      displayName: string | null;
      status: TeamMemberStatus;
      invitedByHostId: string | null;
      joinedAt: Date | null;
    },
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE team_members
          SET removed_at = NULL,
              host_id = $2,
              display_name = $3,
              status = $4,
              invited_by_host_id = $5,
              joined_at = $6,
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        data.hostId,
        data.displayName,
        data.status,
        data.invitedByHostId,
        data.joinedAt,
      ]
    );

    return this.findById(id, client);
  },

  /**
   * Liga uma conta ao membro pendente depois de o convite de equipa ser
   * aceite. O email já foi verificado na aceitação; aqui só se liga a
   * conta e se activa a linha.
   */
  async acceptInvite(
    id: string,
    data: { hostId: string; displayName: string | null },
    client?: PoolClient
  ): Promise<TeamMemberWithStats | null> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE team_members
          SET host_id = $2,
              display_name = COALESCE($3, display_name),
              status = 'ativo',
              joined_at = COALESCE(joined_at, now()),
              removed_at = NULL,
              updated_at = now()
        WHERE id = $1
          AND removed_at IS NULL`,
      [id, data.hostId, data.displayName]
    );

    return this.findById(id, client);
  },

  async softRemove(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE team_members
          SET removed_at = now(), updated_at = now()
        WHERE id = $1
          AND removed_at IS NULL`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async openTasksForMember(
    memberId: string,
    client?: PoolClient
  ): Promise<Array<{ id: string; title: string; status: string }>> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string; title: string; status: string }>(
      `SELECT id, title, status
         FROM host_tasks
        WHERE assignee_member_id = $1
          AND status <> 'concluida'
          AND archived_at IS NULL
        ORDER BY created_at ASC, id ASC`,
      [memberId]
    );

    return result.rows;
  },

  async reassignOpenTasks(
    memberId: string,
    targetMemberId: string,
    client: PoolClient
  ): Promise<number> {
    const result = await client.query(
      `UPDATE host_tasks
          SET assignee_member_id = $2,
              updated_at = now()
        WHERE assignee_member_id = $1
          AND status <> 'concluida'
          AND archived_at IS NULL`,
      [memberId, targetMemberId]
    );

    return result.rowCount ?? 0;
  },

  async countActiveByTeam(teamId: string, client?: PoolClient): Promise<number> {
    const runner = client ?? pool;
    const result = await runner.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM team_members
        WHERE team_id = $1
          AND removed_at IS NULL`,
      [teamId]
    );

    return Number(result.rows[0]?.total ?? '0');
  },
};

export type { TeamMember };
