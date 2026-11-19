import { PoolClient } from 'pg';
import { pool, query } from '../database/pool';
import { EventAccessScope } from '../types/event.types';
import { Task, TaskPriority, TaskStatus } from '../types/team.types';

interface TaskRow {
  id: string;
  host_id: string;
  event_id: string | null;
  event_title: string | null;
  team_id: string | null;
  team_name: string | null;
  assignee_member_id: string | null;
  assignee_email: string | null;
  assignee_display_name: string | null;
  assignee_has_access: boolean | null;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  created_by_host_id: string | null;
  completed_by_member_id: string | null;
  completed_at: Date | null;
  archived_at: Date | null;
  label: string;
  done: boolean;
  manager_id: string | null;
  manager_email: string | null;
  created_at: Date;
  updated_at: Date;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    hostId: row.host_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    teamId: row.team_id,
    teamName: row.team_name,
    assigneeMemberId: row.assignee_member_id,
    assigneeEmail: row.assignee_email,
    assigneeDisplayName: row.assignee_display_name,
    assigneeHasAccess: row.assignee_has_access,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    createdByHostId: row.created_by_host_id,
    completedByMemberId: row.completed_by_member_id,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    label: row.label,
    done: row.done,
    managerId: row.manager_id,
    managerEmail: row.manager_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_TASK = `
  t.id, t.host_id, t.event_id, t.team_id, t.assignee_member_id,
  t.title, t.description, t.due_date, t.priority, t.status,
  t.created_by_host_id, t.completed_by_member_id, t.completed_at,
  t.archived_at, t.label, t.done, t.manager_id,
  t.created_at, t.updated_at,
  e.title AS event_title,
  tm.name AS team_name,
  am.email AS assignee_email,
  am.display_name AS assignee_display_name,
  CASE
    WHEN t.assignee_member_id IS NULL THEN NULL
    WHEN am.removed_at IS NOT NULL THEN false
    WHEN am.is_host THEN true
    WHEN am.role = 'gestor' THEN EXISTS (
      SELECT 1
        FROM event_managers x
       WHERE x.event_id = t.event_id
         AND x.email = am.email
         AND x.revoked_at IS NULL
    )
    ELSE true
  END AS assignee_has_access,
  em.email AS manager_email
`;

const FROM_TASK = `
  FROM host_tasks t
  LEFT JOIN events e ON e.id = t.event_id
  LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN team_members am ON am.id = t.assignee_member_id
  LEFT JOIN event_managers em ON em.id = t.manager_id
`;

/**
 * Condição de acesso a tarefas.
 *
 * - tarefas pessoais/legadas (`team_id IS NULL`) só para quem as criou;
 * - tarefas com equipa para o anfitrião do evento, gestores activos e
 *   membros activos da própria equipa.
 *
 * A condição é aplicada na própria consulta para que a pesquisa `q` e
 * os filtros nunca devolvam recursos de eventos sem acesso.
 */
function accessCondition(
  values: unknown[],
  scope: EventAccessScope,
  alias = 't'
): string {
  values.push(scope.hostId);
  const hostParam = values.length;

  const parts = [
    `(${alias}.team_id IS NULL AND ${alias}.host_id = $${hostParam})`,
  ];

  if (scope.managerEmail) {
    values.push(scope.managerEmail);
    const emailParam = values.length;

    parts.push(
      `(${alias}.team_id IS NOT NULL AND EXISTS (
         SELECT 1
           FROM teams access_team
           JOIN events access_event ON access_event.id = access_team.event_id
          WHERE access_team.id = ${alias}.team_id
            AND access_team.deleted_at IS NULL
            AND (
              access_event.host_id = $${hostParam}
              OR EXISTS (
                SELECT 1 FROM event_managers access_manager
                 WHERE access_manager.event_id = access_event.id
                   AND access_manager.email = $${emailParam}::citext
                   AND access_manager.revoked_at IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM team_members access_member
                 WHERE access_member.team_id = access_team.id
                   AND access_member.email = $${emailParam}::citext
                   AND access_member.removed_at IS NULL
              )
            )
       ))`
    );
  } else {
    parts.push(
      `(${alias}.team_id IS NOT NULL AND EXISTS (
         SELECT 1
           FROM teams access_team
           JOIN events access_event ON access_event.id = access_team.event_id
          WHERE access_team.id = ${alias}.team_id
            AND access_team.deleted_at IS NULL
            AND access_event.host_id = $${hostParam}
       ))`
    );
  }

  return `(${parts.join(' OR ')})`;
}

export interface TaskListFilters {
  scope: EventAccessScope;
  eventId?: string;
  teamId?: string;
  status?: TaskStatus;
  assignee?: 'all' | 'host' | 'manager' | 'member';
  managerId?: string;
  assigneeMemberId?: string;
  priority?: TaskPriority;
  personal?: boolean;
  q?: string;
  offset: number;
  limit: number;
}

export interface CreateTaskData {
  hostId: string;
  eventId: string | null;
  teamId: string | null;
  assigneeMemberId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  createdByHostId: string;
  managerId?: string | null;
  /**
   * Definido pelo serviço apenas quando a conta autenticada é o
   * responsável e cria a tarefa já concluída. O trigger não infere
   * este valor.
   */
  completedByMemberId?: string | null;
}

export const taskRepository = {
  async create(data: CreateTaskData, client?: PoolClient): Promise<Task> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `INSERT INTO host_tasks (
         host_id, event_id, team_id, assignee_member_id, title, description,
         due_date, priority, status, created_by_host_id, manager_id,
         completed_by_member_id, completed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               CASE WHEN $9 = 'concluida' THEN now() ELSE NULL END)
       RETURNING id`,
      [
        data.hostId,
        data.eventId,
        data.teamId,
        data.assigneeMemberId,
        data.title,
        data.description,
        data.dueDate,
        data.priority,
        data.status,
        data.createdByHostId,
        data.managerId ?? null,
        data.completedByMemberId ?? null,
      ]
    );

    const id = result.rows[0]?.id;
    if (!id) throw new Error('Falha ao criar tarefa.');

    const task = await this.findById(id, client);
    if (!task) throw new Error('Falha ao ler a tarefa criada.');
    return task;
  },

  async findById(id: string, client?: PoolClient): Promise<Task | null> {
    const runner = client ?? pool;
    const result = await runner.query<TaskRow>(
      `SELECT ${SELECT_TASK} ${FROM_TASK} WHERE t.id = $1`,
      [id]
    );

    const row = result.rows[0];
    return row ? toTask(row) : null;
  },

  async findByIdForUpdate(id: string, client: PoolClient): Promise<Task | null> {
    const result = await client.query<TaskRow>(
      `SELECT ${SELECT_TASK} ${FROM_TASK}
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [id]
    );

    const row = result.rows[0];
    return row ? toTask(row) : null;
  },

  async list(filters: TaskListFilters): Promise<{ items: Task[]; total: number }> {
    const values: unknown[] = [];
    const conditions = ['t.archived_at IS NULL', accessCondition(values, filters.scope)];

    if (filters.eventId) {
      values.push(filters.eventId);
      conditions.push(`t.event_id = $${values.length}`);
    }
    if (filters.teamId) {
      values.push(filters.teamId);
      conditions.push(`t.team_id = $${values.length}`);
    }
    if (filters.personal) {
      conditions.push('t.team_id IS NULL');
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`t.status = $${values.length}`);
    }
    if (filters.assignee === 'host') {
      conditions.push('(t.assignee_member_id IS NULL OR am.is_host)');
    }
    if (filters.assignee === 'manager') {
      conditions.push(`(t.assignee_member_id IS NOT NULL AND NOT am.is_host AND am.role = 'gestor')`);
    }
    if (filters.assignee === 'member') {
      conditions.push(`(t.assignee_member_id IS NOT NULL AND am.role = 'membro')`);
    }
    if (filters.managerId) {
      values.push(filters.managerId);
      conditions.push(`t.manager_id = $${values.length}`);
    }
    if (filters.assigneeMemberId) {
      values.push(filters.assigneeMemberId);
      conditions.push(`t.assignee_member_id = $${values.length}`);
    }
    if (filters.priority) {
      values.push(filters.priority);
      conditions.push(`t.priority = $${values.length}`);
    }
    if (filters.q) {
      values.push(`%${filters.q}%`);
      const qParam = values.length;
      conditions.push(
        `(t.title ILIKE $${qParam}
          OR t.description ILIKE $${qParam}
          OR tm.name ILIKE $${qParam}
          OR e.title ILIKE $${qParam}
          OR am.email ILIKE $${qParam}
          OR am.display_name ILIKE $${qParam})`
      );
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ total: string }>(
      `SELECT count(*)::text AS total
       ${FROM_TASK}
        WHERE ${where}`,
      values
    );

    const listValues = [...values, filters.limit, filters.offset];
    const result = await query<TaskRow>(
      `SELECT ${SELECT_TASK}
       ${FROM_TASK}
        WHERE ${where}
        ORDER BY
          CASE t.status
            WHEN 'em_curso' THEN 0
            WHEN 'por_fazer' THEN 1
            ELSE 2
          END,
          t.due_date ASC NULLS LAST,
          t.created_at DESC,
          t.id DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );

    return {
      items: result.rows.map(toTask),
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  },

  async update(
    id: string,
    changes: {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      priority?: TaskPriority;
      status?: TaskStatus;
    },
    client?: PoolClient
  ): Promise<Task | null> {
    const runner = client ?? pool;
    const set: string[] = [];
    const values: unknown[] = [];

    if (changes.title !== undefined) {
      values.push(changes.title);
      set.push(`title = $${values.length}`);
    }
    if (changes.description !== undefined) {
      values.push(changes.description);
      set.push(`description = $${values.length}`);
    }
    if (changes.dueDate !== undefined) {
      values.push(changes.dueDate);
      set.push(`due_date = $${values.length}`);
    }
    if (changes.priority !== undefined) {
      values.push(changes.priority);
      set.push(`priority = $${values.length}`);
    }
    if (changes.status !== undefined) {
      values.push(changes.status);
      set.push(`status = $${values.length}`);
    }

    if (set.length === 0) {
      return this.findById(id, client);
    }

    values.push(id);
    await runner.query(
      `UPDATE host_tasks
          SET ${set.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
          AND archived_at IS NULL`,
      values
    );

    return this.findById(id, client);
  },

  /**
   * Conclusão atómica: só actualiza se a tarefa ainda não estiver
   * concluída e o responsável coincidir. O segundo pedido concorrente
   * bloqueia na linha, vê o estado já concluído e não volta a escrever
   * `completed_at` nem a gerar um segundo evento de notificação.
   */
  async complete(
    id: string,
    assigneeMemberId: string,
    client?: PoolClient
  ): Promise<{ task: Task; changed: boolean } | null> {
    const runner = client ?? pool;
    const result = await runner.query<{ id: string }>(
      `UPDATE host_tasks
          SET status = 'concluida',
              completed_at = now(),
              completed_by_member_id = $2,
              updated_at = now()
        WHERE id = $1
          AND assignee_member_id = $2
          AND status <> 'concluida'
          AND archived_at IS NULL
        RETURNING id`,
      [id, assigneeMemberId]
    );

    const current = await this.findById(id, client);
    if (!current) return null;

    return { task: current, changed: (result.rowCount ?? 0) > 0 };
  },

  async reassign(
    id: string,
    assigneeMemberId: string,
    client?: PoolClient
  ): Promise<Task | null> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE host_tasks
          SET assignee_member_id = $2, updated_at = now()
        WHERE id = $1
          AND archived_at IS NULL`,
      [id, assigneeMemberId]
    );

    return this.findById(id, client);
  },

  async moveToTeam(
    id: string,
    teamId: string,
    assigneeMemberId: string,
    client?: PoolClient
  ): Promise<Task | null> {
    const runner = client ?? pool;
    await runner.query(
      `UPDATE host_tasks
          SET team_id = $2,
              assignee_member_id = $3,
              archived_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [id, teamId, assigneeMemberId]
    );

    return this.findById(id, client);
  },

  async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM host_tasks WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },
};
