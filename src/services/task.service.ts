import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { eventManagerRepository } from '../repositories/eventManager.repository';
import { eventRepository } from '../repositories/event.repository';
import { notificationRepository } from '../repositories/notification.repository';
import { taskRepository } from '../repositories/task.repository';
import { CreateTaskBody, TasksQuery, UpdateTaskBody } from '../schemas/host.schemas';
import { EventAccessScope } from '../types/event.types';
import { HostTask } from '../types/host.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

export interface TaskListResult {
  items: HostTask[];
  pagination: PaginationMeta;
}

const TASK_NOT_FOUND = 'Tarefa não encontrada.';

async function assertEventAccess(
  scope: EventAccessScope,
  eventId: string
): Promise<void> {
  const access = await eventRepository.findByIdForAccess(eventId, scope);

  if (!access) {
    throw new NotFoundError('Evento não encontrado.', 'event_not_found');
  }
}

async function assertEventOwned(hostId: string, eventId: string): Promise<void> {
  const event = await eventRepository.findByIdForHost(eventId, hostId);

  if (!event) {
    throw new NotFoundError('Evento não encontrado.', 'event_not_found');
  }
}

export const taskService = {
  async list(scope: EventAccessScope, query: TasksQuery): Promise<TaskListResult> {
    if (query.event_id) {
      await assertEventAccess(scope, query.event_id);
    }

    const page = toPageParams(query.page, query.page_size);
    const { items, total } = await taskRepository.listForHost({
      hostId: scope.hostId,
      managerEmail: scope.managerEmail,
      eventId: query.event_id,
      status: query.status,
      assignee: query.assignee,
      managerFilterId: query.manager_id,
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
   * Só o anfitrião cria tarefas. Uma tarefa atribuída a um gestor tem
   * de pertencer a um evento do próprio anfitrião e o gestor tem de
   * estar activo nesse evento.
   */
  async create(scope: EventAccessScope, input: CreateTaskBody): Promise<HostTask> {
    const eventId = input.event_id ?? null;
    const managerId = input.manager_id ?? null;

    if (eventId) {
      await assertEventOwned(scope.hostId, eventId);
    }

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
    }

    const task = await taskRepository.create({
      hostId: scope.hostId,
      eventId,
      managerId,
      label: input.label,
    });

    if (managerId && eventId) {
      await notificationRepository.createForManager(managerId, {
        eventId,
        kind: 'task_assigned',
        title: 'Nova tarefa',
        body: task.label,
        metadata: { task_id: task.id },
      });
    }

    return task;
  },

  /**
   * O anfitrião pode editar a descrição e o estado. Um gestor só pode
   * alternar `done` nas tarefas que lhe foram atribuídas.
   */
  async update(
    scope: EventAccessScope,
    taskId: string,
    input: UpdateTaskBody
  ): Promise<HostTask> {
    const owned = await taskRepository.findByIdForHost(taskId, scope.hostId);

    if (owned) {
      const updated = await taskRepository.update(taskId, scope.hostId, input);

      if (!updated) {
        throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
      }

      return updated;
    }

    if (!scope.managerEmail) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    const assigned = await taskRepository.findByIdForManager(taskId, scope.managerEmail);

    if (!assigned) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    if (input.label !== undefined) {
      throw new ForbiddenError(
        'Apenas o anfitrião pode alterar a descrição da tarefa.',
        'host_action_forbidden'
      );
    }

    if (input.done === undefined) {
      return assigned;
    }

    const updated = await taskRepository.setDoneForManager(
      taskId,
      scope.managerEmail,
      input.done
    );

    if (!updated) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }

    if (input.done && !assigned.done) {
      await notificationRepository.createForHost({
        hostId: assigned.hostId,
        eventId: assigned.eventId,
        kind: 'task_completed',
        title: 'Tarefa cumprida',
        body: `${scope.managerEmail} concluiu: ${assigned.label}`,
        metadata: { task_id: assigned.id, manager_email: scope.managerEmail },
      });
    }

    return updated;
  },

  async remove(scope: EventAccessScope, taskId: string): Promise<void> {
    const deleted = await taskRepository.delete(taskId, scope.hostId);

    if (!deleted) {
      throw new NotFoundError(TASK_NOT_FOUND, 'task_not_found');
    }
  },
};
