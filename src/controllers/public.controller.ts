import { Request, Response } from 'express';
import { toPublicInvitationDto } from '../dto/invitation.dto';
import { NotFoundError } from '../errors';
import { RsvpBody } from '../schemas/invitation.schemas';
import {
  invitationService,
  isRsvpDeadlinePassed,
} from '../services/invitation.service';
import { Event } from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import { readGuestSession, setGuestSession } from '../utils/cookie.util';
import { csrfTokenFor } from '../utils/token.util';

const INVITATION_NOT_FOUND = 'Convite não encontrado.';

function requireEvent(req: Request): Event {
  if (!req.event) {
    throw new Error('Evento não resolvido: falta o middleware guestAuth.');
  }

  return req.event;
}

function requireInvitation(req: Request): Invitation {
  if (!req.invitation) {
    throw new Error('Convite não resolvido: falta o middleware guestAuth.');
  }

  return req.invitation;
}

type PublicPresentation = ReturnType<typeof toPublicInvitationDto> & {
  csrf_token: string;
};

function present(event: Event, invitation: Invitation, capability: string): PublicPresentation {
  return {
    ...toPublicInvitationDto(event, invitation, isRsvpDeadlinePassed(event)),
    csrf_token: csrfTokenFor(capability),
  };
}

export const publicController = {
  /**
   * Primeiro claim do convite. Emite o cookie de capacidade apenas
   * quando é criada uma nova; um browser que já tenha capacidade
   * reutiliza-a para reclamar convites adicionais.
   */
  claim: async (req: Request, res: Response): Promise<void> => {
    const result = await invitationService.claim(
      req.params.token ?? '',
      readGuestSession(req)
    );

    if (result.newCapability) {
      setGuestSession(res, result.capability);
    }

    res.status(200).json({
      data: present(result.event, result.invitation, result.capability),
    });
  },

  /**
   * Consulta autenticada pela capacidade do navegador.
   *
   * É síncrono: o `guestAuth` já carregou evento e convite. Como o
   * Express 4 captura excepções síncronas, não precisa do wrapper
   * `asyncHandler`.
   */
  get: (req: Request, res: Response): void => {
    const capability = readGuestSession(req);

    if (!capability) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    res.status(200).json({
      data: present(requireEvent(req), requireInvitation(req), capability),
    });
  },

  /** RSVP do próprio convidado (aceitar, alterar ou recusar). */
  rsvp: async (req: Request, res: Response): Promise<void> => {
    const capability = readGuestSession(req);

    if (!capability) {
      throw new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found');
    }

    const body = req.body as RsvpBody;
    const result = await invitationService.respond(
      requireEvent(req).id,
      requireInvitation(req).id,
      capability,
      body.status
    );

    res.status(200).json({
      data: present(result.event, result.invitation, capability),
    });
  },
};
