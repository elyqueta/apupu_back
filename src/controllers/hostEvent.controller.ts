import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
import { CreateEventBody } from '../schemas/event.schemas';
import { HostEventsQuery } from '../schemas/host.schemas';
import { hostEventService } from '../services/hostEvent.service';
import { HostTotals } from '../types/event.types';

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

function toTotalsDto(totals: HostTotals): Record<string, number> {
  return {
    events: totals.events,
    drafts: totals.drafts,
    scheduled: totals.scheduled,
    cancelled: totals.cancelled,
    completed: totals.completed,
    total_invitations: totals.totalInvitations,
    accepted: totals.accepted,
    declined: totals.declined,
    pending: totals.pending,
  };
}

export const hostEventController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await hostEventService.list(
      requireHostId(req),
      req.query as unknown as HostEventsQuery
    );

    res.status(200).json({
      data: result.items.map((event) => toEventDto(event, event.stats)),
      pagination: result.pagination,
    });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const result = await hostEventService.create(
      requireHostId(req),
      req.body as CreateEventBody
    );

    res.status(201).json({
      data: {
        event: toEventDto(result.event),
        manage_email_status: result.manageEmailStatus,
        deliveries: result.deliveries,
      },
    });
  },

  dashboard: async (req: Request, res: Response): Promise<void> => {
    const dashboard = await hostEventService.dashboard(requireHostId(req));

    res.status(200).json({
      data: {
        next_event: dashboard.next_event
          ? toEventDto(dashboard.next_event, dashboard.next_event.stats)
          : null,
        upcoming: dashboard.upcoming.map((event) => toEventDto(event, event.stats)),
        totals: toTotalsDto(dashboard.totals),
      },
    });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    await hostEventService.remove(requireHostId(req), req.params.eventId ?? '');
    res.status(204).send();
  },
};
