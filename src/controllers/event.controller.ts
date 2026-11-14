import { Request, Response } from 'express';
import { toEventDto } from '../dto/event.dto';
import { toInvitationDto } from '../dto/invitation.dto';
import { CreateEventBody, UpdateEventBody } from '../schemas/event.schemas';
import { eventService } from '../services/event.service';
import { invitationService } from '../services/invitation.service';
import { Event } from '../types/event.types';

function requireEvent(req: Request): Event {
  if (!req.event) {
    // Só acontece se a rota for montada sem o middleware hostAuth —
    // é um erro de programação, não de utilizador.
    throw new Error('Evento não resolvido: falta o middleware hostAuth.');
  }

  return req.event;
}

export const eventController = {
  /**
   * Cria o evento e enfileira os convites. O segredo de gestão nunca
   * aparece na resposta: é enviado uma única vez para o email do
   * anfitrião.
   */
  create: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as CreateEventBody;
    const result = await eventService.create(body);

    res.status(201).json({
      data: {
        event: toEventDto(result.event),
        manage_email_status: result.manageEmailStatus,
        deliveries: result.deliveries,
      },
    });
  },

  /** Evento, estatísticas e lista privada de convidados (só com sessão). */
  get: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const [stats, invitations] = await Promise.all([
      eventService.statsFor(event),
      invitationService.list(event.id),
    ]);

    res.status(200).json({
      data: {
        event: toEventDto(event, stats),
        invitations: invitations.map(toInvitationDto),
      },
    });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const event = requireEvent(req);
    const body = req.body as UpdateEventBody;
    const updated = await eventService.update(event.id, body);

    res.status(200).json({ data: toEventDto(updated) });
  },
};
