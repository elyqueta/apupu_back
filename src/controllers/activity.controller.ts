import { Request, Response } from 'express';
import { toActivityDto, toActivityWithEventDto } from '../dto/activity.dto';
import { activityService } from '../services/activity.service';
import { EventAccessScope } from '../types/event.types';

function accessScope(req: Request): EventAccessScope {
  if (req.hostAccount) {
    return {
      hostId: req.hostAccount.id,
      managerEmail: req.hostAccount.emailVerifiedAt ? req.hostAccount.email : null,
    };
  }

  // Sessão legada por link de gestão: o hostAuth já validou o acesso.
  if (req.event?.hostId) {
    return { hostId: req.event.hostId, managerEmail: null };
  }

  throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
}

interface ActivityQuery {
  page: number;
  page_size: number;
}

export const activityController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ActivityQuery;
    const result = await activityService.listForHost(
      accessScope(req),
      query.page,
      query.page_size
    );

    res.status(200).json({
      data: result.items.map(toActivityWithEventDto),
      pagination: result.pagination,
    });
  },

  listForEvent: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ActivityQuery;
    const result = await activityService.listForEvent(
      accessScope(req),
      req.params.eventId ?? '',
      query.page,
      query.page_size
    );

    res.status(200).json({
      data: result.items.map(toActivityDto),
      pagination: result.pagination,
    });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    await activityService.remove(
      accessScope(req),
      req.params.eventId ?? '',
      req.params.activityId ?? ''
    );

    res.status(204).send();
  },
};
