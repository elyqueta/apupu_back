import { Request, Response } from 'express';
import { toActivityDto, toActivityWithEventDto } from '../dto/activity.dto';
import { activityService } from '../services/activity.service';

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

interface ActivityQuery {
  page: number;
  page_size: number;
}

export const activityController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ActivityQuery;
    const result = await activityService.listForHost(
      requireHostId(req),
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
      requireHostId(req),
      req.params.eventId ?? '',
      query.page,
      query.page_size
    );

    res.status(200).json({
      data: result.items.map(toActivityDto),
      pagination: result.pagination,
    });
  },
};
