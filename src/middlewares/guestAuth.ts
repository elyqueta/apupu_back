import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors';
import { eventRepository } from '../repositories/event.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { accountOwnsInvitation, resolveAccountIdentity } from '../services/guestAccess.service';
import { readGuestSession } from '../utils/cookie.util';
import { hashesMatch, hashToken } from '../utils/token.util';

const INVITATION_NOT_FOUND = 'Convite não encontrado.';

/**
 * Autoriza a consulta/RSVP de um convite.
 *
 * Dois caminhos:
 * 1. capacidade do navegador emitida no claim (`apupu_guest`);
 * 2. sessão de conta (`apupu_auth`) cujo email verificado coincide
 *    com o email do convite — permite abrir o mesmo convite em
 *    qualquer navegador e alterar a resposta RSVP.
 *
 * Qualquer falha — token inexistente, convite revogado, cookie ausente
 * ou de outro navegador, conta sem correspondência — produz
 * exactamente a mesma resposta 404. Isso impede enumerar convites ou
 * descobrir se um link já foi reclamado.
 */
export async function guestAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;

    if (!token) {
      next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
      return;
    }

    const invitation = await invitationRepository.findByTokenHash(hashToken(token));

    if (!invitation || invitation.claimRevokedAt) {
      next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
      return;
    }

    const capability = readGuestSession(req);
    const capabilityMatches = Boolean(
      capability &&
        invitation.claimHash &&
        hashesMatch(hashToken(capability), invitation.claimHash)
    );

    let access: Express.Request['guestAccess'];

    if (capabilityMatches && capability) {
      access = { kind: 'capability', secret: capability };
    } else {
      const account = await resolveAccountIdentity(req);

      if (!accountOwnsInvitation(invitation, account)) {
        next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
        return;
      }

      access = { kind: 'account', secret: account.sessionToken, email: account.email };
    }

    const event = await eventRepository.findById(invitation.eventId);

    if (!event) {
      next(new NotFoundError(INVITATION_NOT_FOUND, 'invitation_not_found'));
      return;
    }

    req.invitation = invitation;
    req.event = event;
    req.guestAccess = access;

    next();
  } catch (error) {
    next(error);
  }
}
