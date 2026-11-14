import { Request, Response } from 'express';
import { toInvitationDto } from '../dto/invitation.dto';
import { CreateInvitationBody, UpdateInvitationBody } from '../schemas/event.schemas';
import { invitationService } from '../services/invitation.service';
import { Event } from '../types/event.types';

function requireEvent(req: Request): Event {
  if (!req.event) {
    throw new Error('Evento não resolvido: falta o middleware hostAuth.');
  }

  return req.event;
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

    res.status(200).json({ data: toInvitationDto(invitation) });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    await invitationService.remove(event.id, req.params.invitationId ?? '');
    res.status(204).send();
  },

  resend: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const status = await invitationService.resend(event.id, req.params.invitationId ?? '');
    res.status(202).json({ data: { status } });
  },

  revoke: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const invitation = await invitationService.revoke(
      event.id,
      req.params.invitationId ?? ''
    );

    res.status(200).json({ data: toInvitationDto(invitation) });
  },
};
