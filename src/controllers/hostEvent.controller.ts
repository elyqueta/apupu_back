import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
import { CreateEventBody } from '../schemas/event.schemas';
import { HostEventsQuery } from '../schemas/host.schemas';
import { auditService } from '../services/audit.service';
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
    const hostId = requireHostId(req);
    const result = await hostEventService.create(hostId, req.body as CreateEventBody);

    await auditService.recordRequest(req, {
      action: 'event_created',
      hostId,
      eventId: result.event.id,
      metadata: { guest_count: result.deliveries.length },
    });

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
    const hostId = requireHostId(req);
    const eventId = req.params.eventId ?? '';
    await hostEventService.remove(hostId, eventId);

    await auditService.recordRequest(req, {
      action: 'event_deleted',
      hostId,
      eventId,
    });

    res.status(204).send();
  },

  resendManageLink: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const result = await hostEventService.resendManageLink(hostId, req.params.eventId ?? '');

    await auditService.recordRequest(req, {
      action: 'manage_link_resent',
      hostId,
      eventId: result.eventId,
      metadata: { manage_email_status: result.status },
    });

    res.status(202).json({
      data: {
        event_id: result.eventId,
        manage_email_status: result.status,
        manage_token_expires_at: result.expiresAt?.toISOString() ?? null,
      },
    });
  },
};
