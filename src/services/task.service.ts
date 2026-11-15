import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { taskRepository } from '../repositories/task.repository';
import { CreateTaskBody, UpdateTaskBody } from '../schemas/host.schemas';
import { HostTask } from '../types/host.types';

async function assertEventOwned(hostId: string, eventId: string): Promise<void> {
  const event = await eventRepository.findByIdForHost(eventId, hostId);

  if (!event) {
    throw new NotFoundError('Evento não encontrado.', 'event_not_found');
  }
}

export const taskService = {
  async list(hostId: string, eventId?: string): Promise<HostTask[]> {
    if (eventId) {
      await assertEventOwned(hostId, eventId);
    }

    return taskRepository.listForHost(hostId, eventId);
  },

  async create(hostId: string, input: CreateTaskBody): Promise<HostTask> {
    const eventId = input.event_id ?? null;

    if (eventId) {
      await assertEventOwned(hostId, eventId);
    }

    return taskRepository.create({
      hostId,
      eventId,
      label: input.label,
    });
  },

  async update(hostId: string, taskId: string, input: UpdateTaskBody): Promise<HostTask> {
    const updated = await taskRepository.update(taskId, hostId, input);

    if (!updated) {
      throw new NotFoundError('Tarefa não encontrada.', 'task_not_found');
    }

    return updated;
  },

  async remove(hostId: string, taskId: string): Promise<void> {
    const deleted = await taskRepository.delete(taskId, hostId);

    if (!deleted) {
      throw new NotFoundError('Tarefa não encontrada.', 'task_not_found');
    }
  },
};
