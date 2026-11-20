import { Request, Response } from 'express';
import { toEventManagerDto, toHostEventManagerDto } from '../dto/eventManager.dto';
import { toTeamDto } from '../dto/team.dto';
import {
  AddEventManagerBody,
  RegenerateManagerAccessBody,
  UpdateManagerLinkBody,
} from '../schemas/host.schemas';
import { auditService } from '../services/audit.service';
import { eventManagerService } from '../services/eventManager.service';

function requireHostId(req: Request): string {
  if (!req.hostAccount) {
    throw new Error('Conta não resolvida: falta o middleware hostAccountAuth.');
  }

  return req.hostAccount.id;
}

function routeParams(req: Request): { eventId: string; managerId: string } {
  return {
    eventId: req.params.eventId ?? '',
    managerId: req.params.managerId ?? '',
  };
}

export const eventManagerController = {
  /** Equipa global: gestores de todos os eventos do anfitrião. */
  listAll: async (req: Request, res: Response): Promise<void> => {
    const managers = await eventManagerService.listAll(requireHostId(req));
    res.status(200).json({ data: managers.map(toHostEventManagerDto) });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const managers = await eventManagerService.list(requireHostId(req), req.params.eventId ?? '');
    res.status(200).json({ data: managers.map(toEventManagerDto) });
  },

  add: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const { eventId } = routeParams(req);
    const result = await eventManagerService.add(hostId, eventId, req.body as AddEventManagerBody);

    await auditService.recordRequest(req, {
      action: 'manager_added',
      hostId,
      eventId,
      metadata: {
        manager_id: result.manager.id,
        team_id: result.team.id,
        invite_email_status: result.status,
      },
    });

    // O código em texto só aparece nesta resposta e na regeneração.
    res.status(201).json({
      data: {
        manager: toEventManagerDto(result.manager),
        team: toTeamDto(result.team),
        link: result.link,
        access_code: result.code,
        invite_email_status: result.status,
      },
    });
  },

  /** Troca de código pelo próprio gestor, sem conta de anfitrião. */
  regenerateOwnAccess: async (req: Request, res: Response): Promise<void> => {
    if (!req.hostSession?.managerId) {
      throw new Error('Sessão de gestor não resolvida.');
    }
    const eventId = req.hostSession.eventId;
    const managerId = req.hostSession.managerId;
    const result = await eventManagerService.regenerateOwnAccess(eventId, managerId);

    await auditService.recordRequest(req, {
      action: 'manager_invite_resent',
      hostId: req.event?.hostId ?? null,
      eventId,
      metadata: { manager_id: managerId, reason: 'self_rotate' },
    });

    res.status(200).json({
      data: {
        manager: toEventManagerDto(result.manager),
        link: result.link,
        access_code: result.code,
        invite_email_status: result.status,
      },
    });
  },

  updateLink: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const { eventId, managerId } = routeParams(req);
    const result = await eventManagerService.updateLink(
      hostId,
      eventId,
      managerId,
      req.body as UpdateManagerLinkBody
    );

    await auditService.recordRequest(req, {
      action: 'manager_link_used',
      hostId,
      eventId,
      metadata: { manager_id: managerId, reason: 'validity_changed' },
    });

    res.status(200).json({ data: { manager: toEventManagerDto(result.manager) } });
  },

  regenerateAccess: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const { eventId, managerId } = routeParams(req);
    const result = await eventManagerService.regenerateAccess(
      hostId,
      eventId,
      managerId,
      (req.body ?? {}) as RegenerateManagerAccessBody
    );

    await auditService.recordRequest(req, {
      action: 'manager_invite_resent',
      hostId,
      eventId,
      metadata: { manager_id: managerId, invite_email_status: result.status },
    });

    res.status(200).json({
      data: {
        manager: toEventManagerDto(result.manager),
        link: result.link,
        access_code: result.code,
        invite_email_status: result.status,
      },
    });
  },

  revokeLink: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const { eventId, managerId } = routeParams(req);
    const result = await eventManagerService.revokeLink(hostId, eventId, managerId);

    await auditService.recordRequest(req, {
      action: 'manager_link_used',
      hostId,
      eventId,
      metadata: { manager_id: managerId, reason: 'link_revoked' },
    });

    res.status(200).json({ data: { manager: toEventManagerDto(result.manager) } });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const hostId = requireHostId(req);
    const { eventId, managerId } = routeParams(req);
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
    const { eventId, managerId } = routeParams(req);
    const result = await eventManagerService.resend(hostId, eventId, managerId);

    await auditService.recordRequest(req, {
      action: 'manager_invite_resent',
      hostId,
      eventId,
      metadata: { manager_id: result.manager.id, invite_email_status: result.status },
    });

    res.status(200).json({
      data: {
        manager: toEventManagerDto(result.manager),
        link: result.link,
        access_code: result.code,
        invite_email_status: result.status,
      },
    });
  },
};
