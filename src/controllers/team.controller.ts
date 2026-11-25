import { Request, Response } from 'express';
import { toTeamDto } from '../dto/team.dto';
import {
  CreateTeamBody,
  SetTeamEventsBody,
  TeamListQuery,
  UpdateTeamBody,
} from '../schemas/team.schemas';
import { auditService } from '../services/audit.service';
import { teamPhotoService } from '../services/teamPhoto.service';
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

  setEvents: async (req: Request, res: Response): Promise<void> => {
    const team = await teamService.setEvents(
      accessScope(req),
      req.params.teamId ?? '',
      req.body as SetTeamEventsBody
    );
    await auditService.recordRequest(req, {
      action: 'team_events_changed',
      hostId: accessScope(req).hostId,
      eventId: team.eventId,
      metadata: { team_id: team.id, event_count: team.eventIds.length },
    });
    res.status(200).json({ data: toTeamDto(team) });
  },

  removeEvent: async (req: Request, res: Response): Promise<void> => {
    const team = await teamService.removeEvent(
      accessScope(req),
      req.params.teamId ?? '',
      req.params.eventId ?? ''
    );
    await auditService.recordRequest(req, {
      action: 'team_events_changed',
      hostId: accessScope(req).hostId,
      eventId: team.eventId,
      metadata: { team_id: team.id, event_count: team.eventIds.length },
    });
    res.status(200).json({ data: toTeamDto(team) });
  },

  leave: async (req: Request, res: Response): Promise<void> => {
    await teamService.leave(accessScope(req), req.params.teamId ?? '');
    await auditService.recordRequest(req, {
      action: 'team_left',
      hostId: accessScope(req).hostId,
      metadata: { team_id: req.params.teamId ?? '' },
    });
    res.status(204).send();
  },

  uploadPhoto: async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'missing_file', message: 'Ficheiro em falta.' });
      return;
    }
    const team = await teamPhotoService.upload(
      accessScope(req),
      req.params.teamId ?? '',
      file.buffer,
      file.mimetype
    );
    res.status(200).json({ data: toTeamDto(team) });
  },

  removePhoto: async (req: Request, res: Response): Promise<void> => {
    const team = await teamPhotoService.remove(accessScope(req), req.params.teamId ?? '');
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
