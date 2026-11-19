import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import {
  Team,
  TeamCategory,
  TeamEventStatus,
  TeamMyRole,
  TeamWithStats,
} from '../types/team.types';

interface TeamRow {
  id: string;
  event_id: string;
  name: string;
  category: TeamCategory;
  description: string | null;
  created_by_host_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  event_title: string;
  event_status: TeamEventStatus;
  member_count: number;
  open_task_count: number;
  my_role?: TeamMyRole;
}

function toTeam(row: TeamRow): TeamWithStats {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    category: row.category,
    description: row.description,
    createdByHostId: row.created_by_host_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventTitle: row.event_title,
    eventStatus: row.event_status,
    memberCount: row.member_count,
    openTaskCount: row.open_task_count,
    myRole: row.my_role,
  };
}

/**
 * Estado observável do evento. `draft`/`cancelled`/`completed` vêm do
 * estado explícito; um evento agendado é classificado pelas datas.
 */
const EVENT_STATUS_SQL = `
  CASE
    WHEN e.status = 'cancelled' THEN 'cancelado'
    WHEN e.status = 'draft' THEN 'rascunho'
    WHEN e.status = 'completed' THEN 'concluido'
    WHEN now() < e.starts_at THEN 'agendado'
    WHEN e.ends_at IS NOT NULL AND now() >= e.ends_at THEN 'concluido'
    ELSE 'em_curso'
  END
`;

/**
 * Papel da conta autenticada na equipa.
 *
 * `$1` é o `host_id` da sessão e `$2` o email efectivo da conta. O
 * anfitrião do evento tem sempre `anfitriao`; os restantes usam a linha
 * de `team_members` (`self`), com fallback para gestor de evento.
 */
const MY_ROLE_SQL = `
  CASE
    WHEN e.host_id = $1 THEN 'anfitriao'
    WHEN self.role IS NOT NULL THEN self.role
    WHEN $2::citext IS NOT NULL AND EXISTS (
      SELECT 1 FROM event_managers em
       WHERE em.event_id = e.id
         AND em.email = $2::citext
         AND em.revoked_at IS NULL
    ) THEN 'gestor'
    ELSE 'membro'
  END
`;

const SELECT_TEAM = `
  t.id, t.event_id, t.name, t.category, t.description,
  t.created_by_host_id, t.deleted_at, t.created_at, t.updated_at,
  e.title AS event_title,
  ${EVENT_STATUS_SQL} AS event_status,
  COALESCE(members.member_count, 0)::int AS member_count,
  COALESCE(tasks.open_task_count, 0)::int AS open_task_count
`;

const FROM_TEAM = `
  FROM teams t
  JOIN events e ON e.id = t.event_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS member_count
      FROM team_members m
     WHERE m.team_id = t.id
       AND m.removed_at IS NULL
  ) members ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS open_task_count
      FROM host_tasks ht
     WHERE ht.team_id = t.id
       AND ht.status <> 'concluida'
       AND ht.archived_at IS NULL
  ) tasks ON true
`;

export interface TeamListFilters {
  hostId: string;
  /** Email verificado da conta; `null` limita a lista ao anfitrião. */
  managerEmail: string | null;
  /**
   * Email efectivo da conta (mesmo por verificar), usado em `my_role` e
   * em `mine`. O anfitrião usa o email da conta.
   */
  actorEmail: string | null;
  eventId?: string;
  category?: TeamCategory;
  role?: TeamMyRole;
  eventStatus?: TeamEventStatus;
  mine?: boolean;
  q?: string;
  offset: number;
  limit: number;
}

const SELF_MEMBER_SQL = `
  LEFT JOIN LATERAL (
    SELECT m.role
      FROM team_members m
     WHERE m.team_id = t.id
       AND m.email = $2::citext
       AND m.removed_at IS NULL
     ORDER BY m.is_host DESC, m.created_at ASC
     LIMIT 1
  ) self ON true
`;

/**
 * "As minhas equipas": fui adicionado como membro/gestor (excluindo a
 * presença implícita do anfitrião) ou tenho tarefas por concluir
 * atribuídas a mim.
 */
const MINE_SQL = `
  (
    EXISTS (
      SELECT 1 FROM team_members mine
       WHERE mine.team_id = t.id
         AND mine.email = $2::citext
         AND mine.removed_at IS NULL
         AND mine.is_host = false
    )
    OR EXISTS (
      SELECT 1
        FROM host_tasks own
        JOIN team_members assignee ON assignee.id = own.assignee_member_id
       WHERE own.team_id = t.id
         AND own.status <> 'concluida'
         AND own.archived_at IS NULL
         AND assignee.email = $2::citext
    )
  )
`;

export interface CreateTeamData {
  eventId: string;
  name: string;
  category: TeamCategory;
  description: string | null;
  createdByHostId: string | null;
}

export const teamRepository = {
  async create(data: CreateTeamData, client?: PoolClient): Promise<TeamWithStats> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `INSERT INTO teams (event_id, name, category, description, created_by_host_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [data.eventId, data.name, data.category, data.description, data.createdByHostId]
    );

    const id = result.rows[0]?.id;
    if (!id) throw new Error('Falha ao criar equipa.');

    const team = await this.findById(id, client);
    if (!team) throw new Error('Falha ao ler a equipa criada.');
    return team;
  },

  async findById(id: string, client?: PoolClient): Promise<TeamWithStats | null> {
    const runner = client ?? pool;
    const result = await runner.query<TeamRow>(
      `SELECT ${SELECT_TEAM} ${FROM_TEAM} WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [id]
    );

    const row = result.rows[0];
    return row ? toTeam(row) : null;
  },

  async findByIdForUpdate(id: string, client: PoolClient): Promise<TeamWithStats | null> {
    const result = await client.query<TeamRow>(
      `SELECT ${SELECT_TEAM} ${FROM_TEAM}
        WHERE t.id = $1 AND t.deleted_at IS NULL
        FOR UPDATE OF t`,
      [id]
    );

    const row = result.rows[0];
    return row ? toTeam(row) : null;
  },

  async listForAccess(
    filters: TeamListFilters
  ): Promise<{ items: TeamWithStats[]; total: number }> {
    // $1 = host da sessão, $2 = email efectivo (usado por my_role/mine).
    const values: unknown[] = [filters.hostId, filters.actorEmail];
    const conditions = ['t.deleted_at IS NULL'];

    const access = ['e.host_id = $1'];

    if (filters.managerEmail) {
      values.push(filters.managerEmail);
      const emailParam = values.length;
      access.push(
        `EXISTS (
           SELECT 1 FROM event_managers em
            WHERE em.event_id = e.id
              AND em.email = $${emailParam}::citext
              AND em.revoked_at IS NULL
         )`
      );
      access.push(
        `EXISTS (
           SELECT 1 FROM team_members self
            WHERE self.team_id = t.id
              AND self.email = $${emailParam}::citext
              AND self.removed_at IS NULL
         )`
      );
    }

    conditions.push(`(${access.join(' OR ')})`);

    if (filters.eventId) {
      values.push(filters.eventId);
      conditions.push(`t.event_id = $${values.length}`);
    }

    if (filters.category) {
      values.push(filters.category);
      conditions.push(`t.category = $${values.length}`);
    }

    if (filters.role) {
      values.push(filters.role);
      conditions.push(`${MY_ROLE_SQL} = $${values.length}`);
    }

    if (filters.eventStatus) {
      values.push(filters.eventStatus);
      conditions.push(`${EVENT_STATUS_SQL} = $${values.length}`);
    }

    if (filters.mine) {
      conditions.push(MINE_SQL);
    }

    if (filters.q) {
      values.push(`%${filters.q}%`);
      conditions.push(`t.name ILIKE $${values.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM teams t
         JOIN events e ON e.id = t.event_id
         ${SELF_MEMBER_SQL}
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<TeamRow>(
      `SELECT ${SELECT_TEAM},
              ${MY_ROLE_SQL} AS my_role
       ${FROM_TEAM}
       ${SELF_MEMBER_SQL}
        WHERE ${where}
        ORDER BY e.starts_at ASC, t.name ASC, t.id ASC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toTeam),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async update(
    id: string,
    changes: {
      name?: string;
      category?: TeamCategory;
      description?: string | null;
    },
    client?: PoolClient
  ): Promise<TeamWithStats | null> {
    const runner = client ?? pool;
    const set: string[] = [];
    const values: unknown[] = [];

    if (changes.name !== undefined) {
      values.push(changes.name);
      set.push(`name = $${values.length}`);
    }
    if (changes.category !== undefined) {
      values.push(changes.category);
      set.push(`category = $${values.length}`);
    }
    if (changes.description !== undefined) {
      values.push(changes.description);
      set.push(`description = $${values.length}`);
    }

    if (set.length === 0) {
      return this.findById(id, client);
    }

    values.push(id);
    await runner.query(
      `UPDATE teams
          SET ${set.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
          AND deleted_at IS NULL`,
      values
    );

    return this.findById(id, client);
  },

  async softDelete(id: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? pool;
    const result = await runner.query(
      `UPDATE teams
          SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Encontra a equipa "Geral" do evento ou cria-a. Usada apenas pela
   * compatibilidade do `POST /host/tasks` antigo, que ainda cria
   * tarefas só com `event_id`.
   */
  async findOrCreateGeneral(
    eventId: string,
    createdByHostId: string | null,
    client?: PoolClient
  ): Promise<TeamWithStats> {
    const runner = client ?? pool;
    const existing = await runner.query<{ id: string }>(
      `SELECT id
         FROM teams
        WHERE event_id = $1
          AND lower(btrim(name)) = 'geral'
          AND deleted_at IS NULL
        LIMIT 1`,
      [eventId]
    );

    const existingId = existing.rows[0]?.id;
    if (existingId) {
      // A equipa pode ter sido criada antes de um gestor ter acesso ao
      // evento. A materialização é idempotente e garante que o staff
      // actual está presente antes de escolher o responsável.
      await runner.query('SELECT team_materialize_event_staff($1)', [existingId]);

      const team = await this.findById(existingId, client);
      if (!team) throw new Error('Falha ao ler a equipa Geral.');
      return team;
    }

    const inserted = await runner.query<{ id: string }>(
      `INSERT INTO teams (event_id, name, category, description, created_by_host_id)
       VALUES ($1, 'Geral', 'outra', $2, $3)
       RETURNING id`,
      [
        eventId,
        'Equipa criada automaticamente para receber as tarefas antigas.',
        createdByHostId,
      ]
    );

    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('Falha ao criar a equipa Geral.');

    await runner.query('SELECT team_materialize_event_staff($1)', [id]);

    const team = await this.findById(id, client);
    if (!team) throw new Error('Falha ao ler a equipa Geral criada.');
    return team;
  },

  async materializeEventStaff(teamId: string, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    await runner.query('SELECT team_materialize_event_staff($1)', [teamId]);
  },

  /** Equipas activas de um evento em que o email é membro. */
  async listActiveForEmailInEvent(
    eventId: string,
    email: string,
    client?: PoolClient
  ): Promise<TeamWithStats[]> {
    const runner = client ?? pool;
    const result = await runner.query<TeamRow>(
      `SELECT ${SELECT_TEAM}
       ${FROM_TEAM}
        WHERE t.event_id = $1
          AND t.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM team_members m
             WHERE m.team_id = t.id
               AND m.email = $2::citext
               AND m.removed_at IS NULL
          )
        ORDER BY t.name ASC, t.id ASC`,
      [eventId, email]
    );

    return result.rows.map(toTeam);
  },

  /** Responsável por omissão: anfitrião, depois o primeiro gestor activo. */
  async defaultAssignee(teamId: string, client?: PoolClient): Promise<string | null> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `SELECT id
         FROM team_members
        WHERE team_id = $1
          AND removed_at IS NULL
        ORDER BY is_host DESC, (role = 'gestor') DESC, created_at ASC, id ASC
        LIMIT 1`,
      [teamId]
    );

    return result.rows[0]?.id ?? null;
  },

  async listOpenTasks(
    teamId: string,
    client?: PoolClient
  ): Promise<Array<{ id: string; title: string; status: string }>> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string; title: string; status: string }>(
      `SELECT id, title, status
         FROM host_tasks
        WHERE team_id = $1
          AND status <> 'concluida'
          AND archived_at IS NULL
        ORDER BY created_at ASC, id ASC`,
      [teamId]
    );

    return result.rows;
  },

  /**
   * Move as tarefas (abertas e concluídas) de uma equipa para outra,
   * mantendo o responsável quando o mesmo email existe na equipa de
   * destino. Caso contrário, usa o responsável por omissão do destino.
   */
  async reassignTasksToTeam(
    sourceTeamId: string,
    targetTeamId: string,
    client: PoolClient
  ): Promise<number> {
    const fallback = await this.defaultAssignee(targetTeamId, client);

    const result = await client.query(
      `UPDATE host_tasks t
          SET team_id = $2,
              assignee_member_id = COALESCE(
                (
                  SELECT target.id
                    FROM team_members target
                    JOIN team_members current ON current.id = t.assignee_member_id
                   WHERE target.team_id = $2
                     AND target.email = current.email
                     AND target.removed_at IS NULL
                   LIMIT 1
                ),
                $3::uuid,
                t.assignee_member_id
              ),
              updated_at = now()
        WHERE t.team_id = $1
          AND t.archived_at IS NULL`,
      [sourceTeamId, targetTeamId, fallback]
    );

    return result.rowCount ?? 0;
  },

  async archiveTasks(teamId: string, client: PoolClient): Promise<number> {
    const result = await client.query(
      `UPDATE host_tasks
          SET archived_at = now(), updated_at = now()
        WHERE team_id = $1
          AND archived_at IS NULL`,
      [teamId]
    );

    return result.rowCount ?? 0;
  },
};

export type { Team };
