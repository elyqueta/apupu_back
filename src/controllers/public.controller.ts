import { Request, Response } from 'express';
import { toPublicInvitationDto } from '../dto/invitation.dto';
import { hostRepository } from '../repositories/host.repository';
import { RsvpBody } from '../schemas/invitation.schemas';
import {
  invitationService,
  isRsvpDeadlinePassed,
} from '../services/invitation.service';
import { resolveAccountIdentity } from '../services/guestAccess.service';
import { Event } from '../types/event.types';
import { GuestAccess } from '../types/guestAccess.types';
import { Invitation } from '../types/invitation.types';
import { readGuestSession, setGuestSession } from '../utils/cookie.util';
import { csrfTokenFor } from '../utils/token.util';

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

function requireAccess(req: Request): GuestAccess {
  if (!req.guestAccess) {
    throw new Error('Acesso não resolvido: falta o middleware guestAuth.');
  }

  return req.guestAccess;
}

type PublicPresentation = ReturnType<typeof toPublicInvitationDto> & {
  csrf_token: string;
};

/**
 * Monta a apresentação pública do convite.
 *
 * Inclui o email do convidado e `email_has_account`, para o frontend
 * poder sugerir criar conta ou entrar quando o convite é aberto sem
 * sessão. O valor é calculado por pedido (não é persistido) e nunca
 * expõe se o convite pertence a outro navegador.
 */
async function present(
  event: Event,
  invitation: Invitation,
  access: GuestAccess
): Promise<PublicPresentation> {
  const [emailHasAccount, contact] = await Promise.all([
    hostRepository.emailExists(invitation.guestEmail),
    hostRepository.findPublicContactByEventId(event.id),
  ]);
  const hostContact = contact ?? {
    name: event.hostName,
    email: event.hostEmail,
    phone: null,
    avatarUrl: null,
  };

  return {
    ...toPublicInvitationDto(
      event,
      invitation,
      isRsvpDeadlinePassed(event),
      emailHasAccount,
      hostContact
    ),
    csrf_token: csrfTokenFor(access.secret),
  };
}

export const publicController = {
  /**
   * Primeiro claim do convite. Emite o cookie de capacidade apenas
   * quando é criada uma nova; um browser que já tenha capacidade
   * reutiliza-a para reclamar convites adicionais.
   *
   * Uma conta autenticada com o email do convidado pode reclamar o
   * convite mesmo que ele já pertença a outro navegador.
   */
  claim: async (req: Request, res: Response): Promise<void> => {
    const account = await resolveAccountIdentity(req);
    const result = await invitationService.claim(
      req.params.token ?? '',
      readGuestSession(req),
      account
    );

    if (result.newCapability) {
      setGuestSession(res, result.newCapability);
    }

    res.status(200).json({
      data: await present(result.event, result.invitation, result.access),
    });
  },

  /**
   * Consulta autenticada pela capacidade do navegador ou pela conta.
   *
   * O `guestAuth` já carregou evento, convite e acesso. É assíncrono
   * porque `email_has_account` consulta a tabela de contas.
   */
  get: async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      data: await present(requireEvent(req), requireInvitation(req), requireAccess(req)),
    });
  },

  /** RSVP do próprio convidado (aceitar, alterar ou recusar). */
  rsvp: async (req: Request, res: Response): Promise<void> => {
    const access = requireAccess(req);
    const body = req.body as RsvpBody;
    const result = await invitationService.respond(
      requireEvent(req).id,
      requireInvitation(req).id,
      access,
      body.status,
      body.message
    );

    res.status(200).json({
      data: await present(result.event, result.invitation, access),
    });
  },
};
