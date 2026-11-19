import { Request, Response } from 'express';
import { toTaskDto } from '../dto/task.dto';
import { CreateTaskBody, TasksQuery, UpdateTaskBody } from '../schemas/host.schemas';
import { MoveTaskBody, TaskAssigneeBody, TaskStatusBody } from '../schemas/team.schemas';
import { taskService } from '../services/task.service';
import { EventAccessScope } from '../types/event.types';

function accessScope(req: Request): EventAccessScope {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return {
    hostId: req.hostAccount.id,
    managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
  };
}

export const taskController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as TasksQuery;
    const result = await taskService.list(accessScope(req), query);

    res.status(200).json({
      data: result.items.map(toTaskDto),
      pagination: result.pagination,
    });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.create(accessScope(req), req.body as CreateTaskBody);
    res.status(201).json({ data: toTaskDto(task) });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.update(
      accessScope(req),
      req.params.taskId ?? '',
      req.body as UpdateTaskBody
    );

    res.status(200).json({ data: toTaskDto(task) });
  },

  setStatus: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.setStatus(
      accessScope(req),
      req.params.taskId ?? '',
      req.body as TaskStatusBody
    );

    res.status(200).json({ data: toTaskDto(task) });
  },

  reassign: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.reassign(
      accessScope(req),
      req.params.taskId ?? '',
      req.body as TaskAssigneeBody
    );

    res.status(200).json({ data: toTaskDto(task) });
  },

  move: async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.move(
      accessScope(req),
      req.params.taskId ?? '',
      req.body as MoveTaskBody
    );

    res.status(200).json({ data: toTaskDto(task) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    await taskService.remove(accessScope(req), req.params.taskId ?? '');
    res.status(204).send();
  },
};
