import { Request, Response } from 'express';
import { toTaskDto } from '../dto/task.dto';
import { CreateTaskBody, TasksQuery, UpdateTaskBody } from '../schemas/host.schemas';
import { taskService } from '../services/task.service';

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

export const taskController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const { event_id } = req.query as unknown as TasksQuery;
    const tasks = await taskService.list(requireHostId(req), event_id);

    res.status(200).json({ data: tasks.map(toTaskDto) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.create(
      requireHostId(req),
      req.body as CreateTaskBody
    );

    res.status(201).json({ data: toTaskDto(task) });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.update(
      requireHostId(req),
      req.params.taskId ?? '',
      req.body as UpdateTaskBody
    );

    res.status(200).json({ data: toTaskDto(task) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    await taskService.remove(requireHostId(req), req.params.taskId ?? '');
    res.status(204).send();
  },
};
