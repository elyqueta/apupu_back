import { Request, Response } from 'express';
import { toEventManagerDto, toHostEventManagerDto } from '../dto/eventManager.dto';
import { auditService } from '../services/audit.service';
import { eventManagerService } from '../services/eventManager.service';

interface AddManagerBody {
  email: string;
}

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

export const eventManagerController = {
  /** Equipa global: gestores de todos os eventos do anfitrião. */
  listAll: async (req: Request, res: Response): Promise<void> => {
    const managers = await eventManagerService.listAll(requireHostId(req));

    res.status(200).json({ data: managers.map(toHostEventManagerDto) });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const managers = await eventManagerService.list(
      requireHostId(req),
      req.params.eventId ?? ''
    );

    res.status(200).json({ data: managers.map(toEventManagerDto) });
  },

  add: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const eventId = req.params.eventId ?? '';
    const body = req.body as AddManagerBody;
    const result = await eventManagerService.add(hostId, eventId, body.email);

    await auditService.recordRequest(req, {
      action: 'manager_added',
      hostId,
      eventId,
      metadata: {
        manager_id: result.manager.id,
        invite_email_status: result.status,
      },
    });

    res.status(201).json({
      data: {
        manager: toEventManagerDto(result.manager),
        invite_email_status: result.status,
      },
    });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const eventId = req.params.eventId ?? '';
    const managerId = req.params.managerId ?? '';
    const manager = await eventManagerService.remove(hostId, eventId, managerId);

    await auditService.recordRequest(req, {
      action: 'manager_removed',
      hostId,
      eventId,
      metadata: { manager_id: manager.id },
    });

    res.status(204).send();
  },

  resend: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const eventId = req.params.eventId ?? '';
    const managerId = req.params.managerId ?? '';
    const result = await eventManagerService.resend(hostId, eventId, managerId);

    await auditService.recordRequest(req, {
      action: 'manager_invite_resent',
      hostId,
      eventId,
      metadata: {
        manager_id: result.manager.id,
        invite_email_status: result.status,
      },
    });

    res.status(202).json({
      data: {
        manager: toEventManagerDto(result.manager),
        invite_email_status: result.status,
      },
    });
  },
};
