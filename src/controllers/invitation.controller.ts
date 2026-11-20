import { Request, Response } from 'express';
import { toInvitationDto } from '../dto/invitation.dto';
import { CreateInvitationBody, UpdateInvitationBody } from '../schemas/event.schemas';
import { InvitationLinkBody } from '../schemas/invitation.schemas';
import { auditService } from '../services/audit.service';
import { invitationService } from '../services/invitation.service';
import { Event } from '../types/event.types';

function requireEvent(req: Request): Event {
  if (!req.event) {
    throw new Error('Evento não resolvido: falta o middleware hostAuth.');
  }

  return req.event;
}

function auditHostId(req: Request): string | null {
  return req.hostAccount?.id ?? req.event?.hostId ?? null;
}

export const invitationController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const invitations = await invitationService.list(event.id);

    res.status(200).json({ data: invitations.map(toInvitationDto) });
  },

  add: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const body = req.body as CreateInvitationBody;
    const invitation = await invitationService.add(event, body);

    await auditService.recordRequest(req, {
      action: 'guest_added',
      hostId: auditHostId(req),
      eventId: event.id,
      metadata: { invitation_id: invitation.id },
    });

    res.status(201).json({ data: toInvitationDto(invitation) });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const body = req.body as UpdateInvitationBody;
    const invitation = await invitationService.update(
      event.id,
      req.params.invitationId ?? '',
      body
    );

    await auditService.recordRequest(req, {
      action: 'guest_updated',
      hostId: auditHostId(req),
      eventId: event.id,
      metadata: { invitation_id: invitation.id },
    });

    res.status(200).json({ data: toInvitationDto(invitation) });
  },

  updateLink: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const invitation = await invitationService.updateLink(
      event.id,
      req.params.invitationId ?? '',
      (req.body as InvitationLinkBody).expires_at
    );

    await auditService.recordRequest(req, {
      action: 'guest_updated',
      hostId: auditHostId(req),
      eventId: event.id,
      metadata: {
        invitation_id: invitation.id,
        fields: ['invitation_url_expires_at'],
      },
    });

    res.status(200).json({ data: toInvitationDto(invitation) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const invitationId = req.params.invitationId ?? '';
    await invitationService.remove(event.id, invitationId);

    await auditService.recordRequest(req, {
      action: 'guest_deleted',
      hostId: auditHostId(req),
      eventId: event.id,
      metadata: { invitation_id: invitationId },
    });

    res.status(204).send();
  },

  resend: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const invitationId = req.params.invitationId ?? '';
    const status = await invitationService.resend(event.id, invitationId);

    await auditService.recordRequest(req, {
      action: 'guest_invitation_resent',
      hostId: auditHostId(req),
      eventId: event.id,
      metadata: { invitation_id: invitationId, status },
    });

    res.status(202).json({ data: { status } });
  },

  revoke: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const invitation = await invitationService.revoke(
      event.id,
      req.params.invitationId ?? ''
    );

    await auditService.recordRequest(req, {
      action: 'guest_access_revoked',
      hostId: auditHostId(req),
      eventId: event.id,
      metadata: { invitation_id: invitation.id },
    });

    res.status(200).json({ data: toInvitationDto(invitation) });
  },
};
