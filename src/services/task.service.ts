import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { taskRepository } from '../repositories/task.repository';
import { teamMemberRepository } from '../repositories/teamMember.repository';
import { teamRepository } from '../repositories/team.repository';
import { CreateTaskBody, TasksQuery, UpdateTaskBody } from '../schemas/host.schemas';
import { MoveTaskBody, TaskAssigneeBody, TaskStatusBody } from '../schemas/team.schemas';
import { EventAccessScope } from '../types/event.types';
import { PaginationMeta } from '../types/pagination.types';
import { Task, TaskStatus, TeamWithStats } from '../types/team.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import {
  memberForScope,
  requireEventRole,
  resolveTaskAccess,
  resolveTeamAccess,
  ResourceRole,
} from './teamAccess.service';

export interface TaskListResult {
  items: Task[];
  pagination: PaginationMeta;
}

const TASK_NOT_FOUND = 'Tarefa não encontrada.';

function isManager(role: ResourceRole): boolean {
  return role === 'host' || role === 'manager';
}

/** Nome humano de um membro, para as mensagens de permissão. */
function memberName(member: {
  displayName?: string | null;
  email?: string | null;
} | null): string {
  const name = member?.displayName?.trim();
  if (name) return name;
  if (member?.email) return member.email;
  return 'o responsável';
}

/** Nome humano do responsável, para a mensagem de conclusão. */
function assigneeName(task: Task): string {
  return memberName({
    displayName: task.assigneeDisplayName,
    email: task.assigneeEmail,
  });
}

/**
 * Autor real da tarefa. `hostId` é o dono do evento; `createdByHostId`
 * é quem criou a tarefa, que pode ser um gestor ou um membro.
 */
function isTaskAuthor(task: Task, scope: EventAccessScope): boolean {
  return task.createdByHostId === scope.hostId || task.hostId === scope.hostId;
}

/** `pending`/`done` são aliases legados de `por_fazer`/`concluida`. */
function normalizeStatusFilter(status: TasksQuery['status']): TaskStatus | undefined {
  if (status === 'all') return undefined;
  if (status === 'pending') return 'por_fazer';
  if (status === 'done') return 'concluida';
  return status;
}

/** Traduz o corpo da transição de estado para o estado efectivo. */
function resolveTargetStatus(input: {
  status?: TaskStatus;
  done?: boolean;
}): TaskStatus | undefined {
  if (input.status) return input.status;
  if (input.done === true) return 'concluida';
  if (input.done === false) return 'por_fazer';
  return undefined;
}

/**
 * Regra única para QUALQUER mudança de `done`/`status`.
 *
 * Concluir, reabrir ou passar a `em_curso` só é permitido ao
 * responsável pela tarefa. Tarefas antigas sem responsável
 * (`team_id = null`) pertencem a quem as criou. Um recurso de outro
 * evento já foi resolvido como 404 antes de chegar aqui.
 */
async function assertCanChangeStatus(
  task: Task,
  role: ResourceRole,
  scope: EventAccessScope,
  status: TaskStatus
): Promise<void> {
  if (!task.assigneeMemberId) {
    if (!isTaskAuthor(task, scope)) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }
    return;
  }

  const member = task.teamId ? await memberForScope(task.teamId, role, scope) : null;

  if (!member || member.id !== task.assigneeMemberId) {
    const message =
      status === 'concluida'
        ? `Só ${assigneeName(task)} pode concluir esta tarefa.`
        : `Só ${assigneeName(task)} pode alterar o estado desta tarefa.`;

    throw new ForbiddenError(message, 'task_complete_forbidden');
  }
}

/**
 * Aplica uma transição de estado já validada.
 *
 * A conclusão usa o `UPDATE` condicional do repositório para que dois
 * pedidos concorrentes produzam uma única mudança e um `completed_at`
 * estável. O serviço define `completed_by_member_id`; o trigger apenas
 * sincroniza colunas.
 */
async function applyStatusChange(
  scope: EventAccessScope,
  task: Task,
  role: ResourceRole,
  status: TaskStatus
): Promise<Task> {
  if (status === task.status) {
    return task;
  }

  await assertCanChangeStatus(task, role, scope, status);

  if (status === 'concluida') {
    if (!task.assigneeMemberId) {
      const updated = await taskRepository.update(task.id, { status });
      if (!updated) {
        throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
      }
      return updated;
    }

    const result = await taskRepository.complete(task.id, task.assigneeMemberId);

    if (!result) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    if (result.changed) {
      // TODO(Fase 3): notificar o anfitrião/gestores que a tarefa foi
      // concluída, uma única vez por transição.
    }

    return result.task;
  }

  const updated = await taskRepository.update(task.id, { status });

  if (!updated) {
    throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
  }

  return updated;
}

/**
 * Valida o responsável indicado e garante que pertence à equipa.
 */
async function resolveAssignee(
  teamId: string,
  assigneeMemberId: string | null | undefined,
  role: ResourceRole,
  scope: EventAccessScope
): Promise<string> {
  if (assigneeMemberId) {
    const member = await teamMemberRepository.findById(assigneeMemberId);

    if (!member || member.teamId !== teamId || member.removedAt) {
      throw new ValidationError('Verifique os campos indicados.', {
        assignee_member_id: ['O responsável tem de ser membro activo desta equipa.'],
      });
    }

    return member.id;
  }

  const self = await memberForScope(teamId, role, scope);
  const fallback = self?.id ?? (await teamRepository.defaultAssignee(teamId));

  if (!fallback) {
    throw new ValidationError('Verifique os campos indicados.', {
      team_id: ['Esta equipa ainda não tem anfitrião nem gestor para assumir a tarefa.'],
    });
  }

  return fallback;
}

export const taskService = {
  /**
   * Lista tarefas visíveis para a conta.
   *
   * Filtros de equipa/evento passam sempre pela verificação de acesso:
   * um id de outro evento devolve 404 e nunca filtra por ele. A
   * condição de acesso é aplicada na consulta, pelo que a pesquisa `q`
   * não revela recursos sem acesso.
   */
  async list(scope: EventAccessScope, query: TasksQuery): Promise<TaskListResult> {
    if (query.event_id) {
      await requireEventRole(query.event_id, scope);
    }

    if (query.team_id) {
      await resolveTeamAccess(query.team_id, scope);
    }

    const page = toPageParams(query.page, query.page_size);
    const { items, total } = await taskRepository.list({
      scope,
      eventId: query.event_id,
      teamId: query.team_id,
      status: normalizeStatusFilter(query.status),
      assignee: query.assignee,
      managerId: query.manager_id,
      assigneeMemberId: query.assignee_member_id,
      priority: query.priority,
      personal: query.personal,
      q: query.q,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },

  /**
   * Cria uma tarefa.
   *
   * - com `team_id`: qualquer membro activo dessa equipa;
   * - com `event_id` e sem equipa: anfitrião/gestor, na equipa "Geral"
   *   do evento (compatibilidade com o endpoint antigo);
   * - sem evento nem equipa: tarefa pessoal legada, só para a própria
   *   conta.
   */
  async create(scope: EventAccessScope, input: CreateTaskBody): Promise<Task> {
    const title = input.title ?? input.label;

    if (!title) {
      throw new ValidationError('Verifique os campos indicados.', {
        title: ['A tarefa precisa de uma descrição.'],
      });
    }

    const status = resolveTargetStatus(input) ?? 'por_fazer';

    let eventId = input.event_id ?? null;
    let team: TeamWithStats | null = null;
    let role: ResourceRole | null = null;
    const legacyEventCreate = !input.team_id && Boolean(eventId);

    if (input.team_id) {
      const access = await resolveTeamAccess(input.team_id, scope);
      team = access.team;
      role = access.role;
      eventId = team.eventId;
    } else if (eventId) {
      role = await requireEventRole(eventId, scope);

      if (role === 'member') {
        throw new ValidationError('Verifique os campos indicados.', {
          team_id: ['Indique a equipa em que a tarefa deve ser criada.'],
        });
      }

      team = await teamRepository.findOrCreateGeneral(eventId, scope.hostId);
      eventId = team.eventId;
    }

    let managerId = input.manager_id ?? null;
    let managerEmail: string | null = null;

    if (managerId) {
      if (!eventId) {
        throw new ValidationError('Verifique os campos indicados.', {
          event_id: ['Uma tarefa atribuída a um gestor exige um evento.'],
        });
      }

      const manager = await eventManagerRepository.findActiveById(managerId);

      if (!manager || manager.eventId !== eventId) {
        throw new ValidationError('Verifique os campos indicados.', {
          manager_id: ['O gestor indicado não pertence a este evento.'],
        });
      }

      managerEmail = manager.email;
    }

    let assigneeMemberId: string | null = null;

    if (team) {
      if (managerId) {
        // Compatibilidade: garante que o gestor antigo já existe como
        // membro antes de o escolher como responsável.
        await teamRepository.materializeEventStaff(team.id);
      }

      if (input.assignee_member_id) {
        assigneeMemberId = await resolveAssignee(
          team.id,
          input.assignee_member_id,
          role ?? 'host',
          scope
        );
      } else if (managerEmail) {
        const managerMember = await teamMemberRepository.findActiveByTeamAndEmail(
          team.id,
          managerEmail
        );

        assigneeMemberId =
          managerMember?.id ?? (await resolveAssignee(team.id, null, role ?? 'host', scope));
      } else if (legacyEventCreate) {
        // Endpoint antigo: o responsável por omissão é o anfitrião.
        const hostMember = await teamMemberRepository.findHostMember(team.id);
        assigneeMemberId =
          hostMember?.id ?? (await teamRepository.defaultAssignee(team.id));

        if (!assigneeMemberId) {
          throw new ValidationError('Verifique os campos indicados.', {
            team_id: ['Esta equipa ainda não tem anfitrião nem gestor para assumir a tarefa.'],
          });
        }
      } else {
        assigneeMemberId = await resolveAssignee(team.id, null, role ?? 'host', scope);
      }
    } else {
      if (input.assignee_member_id) {
        throw new ValidationError('Verifique os campos indicados.', {
          team_id: ['Um responsável exige uma equipa.'],
        });
      }

      if (input.event_id) {
        throw new ValidationError('Verifique os campos indicados.', {
          team_id: ['Indique a equipa da tarefa.'],
        });
      }

      managerId = null;
    }

    // Criar já concluída segue a mesma regra de qualquer conclusão: só
    // o responsável. Numa tarefa pessoal legada, o criador é o
    // responsável implícito.
    if (status === 'concluida' && team) {
      const self = await memberForScope(team.id, role ?? 'host', scope);

      if (!self || self.id !== assigneeMemberId) {
        const assignee = assigneeMemberId
          ? await teamMemberRepository.findById(assigneeMemberId)
          : null;

        throw new ForbiddenError(
          `Só ${memberName(assignee)} pode concluir esta tarefa.`,
          'task_complete_forbidden'
        );
      }
    }

    const task = await taskRepository.create({
      hostId: scope.hostId,
      eventId: team?.eventId ?? null,
      teamId: team?.id ?? null,
      assigneeMemberId,
      title,
      description: input.description ?? null,
      dueDate: input.due_date ?? null,
      priority: input.priority,
      status,
      createdByHostId: scope.hostId,
      managerId,
      completedByMemberId: status === 'concluida' ? assigneeMemberId : null,
    });

    // TODO(Fase 3): notificar o responsável pela atribuição da tarefa.

    return task;
  },

  /**
   * Edita os campos da tarefa.
   *
   * O anfitrião e os gestores editam qualquer tarefa do evento; um
   * membro só as que criou. Qualquer mudança de estado (concluir,
   * reabrir ou `em_curso`) segue a regra do responsável, mesmo quando
   * vem no mesmo PATCH dos restantes campos.
   */
  async update(
    scope: EventAccessScope,
    taskId: string,
    input: UpdateTaskBody
  ): Promise<Task> {
    const { task, role } = await resolveTaskAccess(taskId, scope);

    const targetStatus = resolveTargetStatus(input);
    const title = input.title ?? input.label;
    const hasFields =
      title !== undefined ||
      input.description !== undefined ||
      input.due_date !== undefined ||
      input.priority !== undefined;

    // Editar campos (título, descrição, prazo, prioridade) continua a
    // ser exclusivo do anfitrião/gestor ou do autor. O responsável que
    // não criou a tarefa pode mudar apenas o estado, e essa regra é
    // aplicada por `applyStatusChange`.
    if (hasFields && !isManager(role) && !isTaskAuthor(task, scope)) {
      throw new ForbiddenError(
        'Só pode editar as tarefas que criou.',
        'task_edit_forbidden'
      );
    }

    let current = task;

    if (targetStatus) {
      current = await applyStatusChange(scope, task, role, targetStatus);
    }

    if (!hasFields) {
      return current;
    }

    const updated = await taskRepository.update(taskId, {
      title,
      description: input.description,
      dueDate: input.due_date,
      priority: input.priority,
    });

    if (!updated) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    return updated;
  },

  /**
   * Conclui, reabre ou muda o estado de uma tarefa.
   *
   * A transição é exclusiva do responsável e a conclusão é atómica: o
   * `UPDATE` condicional impede um segundo pedido concorrente de
   * sobrescrever `completed_at` ou de gerar uma segunda notificação.
   */
  async setStatus(
    scope: EventAccessScope,
    taskId: string,
    input: TaskStatusBody
  ): Promise<Task> {
    const { task, role } = await resolveTaskAccess(taskId, scope);
    const status = resolveTargetStatus(input);

    if (!status) {
      throw new ValidationError('Verifique os campos indicados.', {
        status: ['Indique o estado da tarefa.'],
      });
    }

    return applyStatusChange(scope, task, role, status);
  },

  /**
   * Reatribui uma tarefa. Exclusivo do anfitrião e dos gestores.
   */
  async reassign(
    scope: EventAccessScope,
    taskId: string,
    input: TaskAssigneeBody
  ): Promise<Task> {
    const { task, role } = await resolveTaskAccess(taskId, scope);

    if (!isManager(role)) {
      throw new ForbiddenError(
        'Só o anfitrião ou um gestor pode reatribuir tarefas.',
        'task_reassign_forbidden'
      );
    }

    if (!task.teamId) {
      throw new ValidationError('Verifique os campos indicados.', {
        assignee_member_id: ['Mova a tarefa para uma equipa antes de a reatribuir.'],
      });
    }

    const member = await teamMemberRepository.findById(input.assignee_member_id);

    if (!member || member.teamId !== task.teamId || member.removedAt) {
      throw new ValidationError('Verifique os campos indicados.', {
        assignee_member_id: ['O responsável tem de ser membro activo desta equipa.'],
      });
    }

    const updated = await taskRepository.reassign(taskId, member.id);

    if (!updated) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    // TODO(Fase 3): notificar o novo responsável e o anterior.

    return updated;
  },

  /**
   * Move a tarefa para outra equipa (inclui "Mover para uma equipa" das
   * tarefas pessoais legadas).
   */
  async move(scope: EventAccessScope, taskId: string, input: MoveTaskBody): Promise<Task> {
    const { task, role } = await resolveTaskAccess(taskId, scope);

    if (!isManager(role) && !isTaskAuthor(task, scope)) {
      throw new ForbiddenError(
        'Só pode mover as tarefas que criou.',
        'task_move_forbidden'
      );
    }

    const target = await resolveTeamAccess(input.team_id, scope);

    let assigneeMemberId = input.assignee_member_id ?? null;

    if (assigneeMemberId) {
      const member = await teamMemberRepository.findById(assigneeMemberId);

      if (!member || member.teamId !== target.team.id || member.removedAt) {
        throw new ValidationError('Verifique os campos indicados.', {
          assignee_member_id: ['O responsável tem de ser membro activo da equipa de destino.'],
        });
      }
    } else if (task.assigneeEmail) {
      // Mantém o responsável quando o mesmo email existe no destino.
      const same = await teamMemberRepository.findActiveByTeamAndEmail(
        target.team.id,
        task.assigneeEmail
      );
      assigneeMemberId = same?.id ?? null;
    }

    if (!assigneeMemberId) {
      assigneeMemberId = await resolveAssignee(
        target.team.id,
        null,
        target.role,
        scope
      );
    }

    const moved = await taskRepository.moveToTeam(taskId, target.team.id, assigneeMemberId);

    if (!moved) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    // TODO(Fase 3): notificar a equipa de destino.

    return moved;
  },

  /**
   * Apaga uma tarefa. O anfitrião e os gestores apagam qualquer tarefa
   * do evento; um membro só as que criou.
   */
  async remove(scope: EventAccessScope, taskId: string): Promise<void> {
    const { task, role } = await resolveTaskAccess(taskId, scope);

    if (!isManager(role) && !isTaskAuthor(task, scope)) {
      throw new ForbiddenError(
        'Só pode apagar as tarefas que criou.',
        'task_delete_forbidden'
      );
    }

    const deleted = await taskRepository.delete(taskId);

    if (!deleted) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }
  },
};
