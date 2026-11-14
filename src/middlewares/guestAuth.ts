import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { readGuestSession } from '../utils/cookie.util';
import { hashesMatch, hashToken } from '../utils/token.util';

const INVITATION_NOT_FOUND = 'Convite não encontrado.';

/**
 * Autoriza a consulta/RSVP de um convite com a capacidade do
 * navegador emitida no claim.
 *
 * Qualquer falha — token inexistente, convite revogado, cookie ausente
 * ou pertencente a outro navegador — produz exactamente a mesma
 * resposta 404. Isso impede enumerar convites ou descobrir se um link
 * já foi reclamado.
 */
export async function guestAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    const capability = readGuestSession(req);

    if (!token || !capability) {
      next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
      return;
    }

    const invitation = await invitationRepository.findByTokenHash(hashToken(token));

    if (
      !invitation ||
      !invitation.claimHash ||
      invitation.claimRevokedAt ||
      !hashesMatch(hashToken(capability), invitation.claimHash)
    ) {
      next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
      return;
    }

    const event = await eventRepository.findById(invitation.eventId);

    if (!event) {
      next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
      return;
    }

    req.invitation = invitation;
    req.event = event;

    next();
  } catch (error) {
    next(error);
  }
}
