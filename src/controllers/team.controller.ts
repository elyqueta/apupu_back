import { Request, Response } from 'express';
import { toTeamDto } from '../dto/team.dto';
import {
  CreateTeamBody,
  TeamListQuery,
  UpdateTeamBody,
} from '../schemas/team.schemas';
import { teamService } from '../services/team.service';
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

export const teamController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await teamService.list(
      accessScope(req),
      req.query as unknown as TeamListQuery
    );

    res.status(200).json({
      data: result.items.map(toTeamDto),
      pagination: result.pagination,
    });
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const team = await teamService.get(accessScope(req), req.params.teamId ?? '');
    res.status(200).json({ data: toTeamDto(team) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const team = await teamService.create(
      accessScope(req),
      req.body as CreateTeamBody
    );
    res.status(201).json({ data: toTeamDto(team) });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const team = await teamService.update(
      accessScope(req),
      req.params.teamId ?? '',
      req.body as UpdateTeamBody
    );
    res.status(200).json({ data: toTeamDto(team) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const result = await teamService.remove(
      accessScope(req),
      req.params.teamId ?? '',
      req.query
    );

    res.status(200).json({
      data: {
        deleted: result.deleted,
        reassigned_to_team_id: result.reassignedToTeamId,
        reassigned_tasks: result.reassignedTasks,
        archived_tasks: result.archivedTasks,
      },
    });
  },
};
