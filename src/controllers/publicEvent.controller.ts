import { invitePresentationService, PresentationExtras } from '../services/invitePresentation.service';
import { Request, Response } from 'express';
import { OpenEventDto, toOpenEventDto } from '../dto/event.dto';
import { hostRepository } from '../repositories/host.repository';
import { PublicEventRsvpBody } from '../schemas/invitation.schemas';
import { AccountIdentity, resolveAccountIdentity } from '../services/guestAccess.service';
import { isRsvpDeadlinePassed } from '../services/invitation.service';
import { publicEventService, PublicEventViewer } from '../services/publicEvent.service';
import { Event } from '../types/event.types';
import { readCsrfHeader } from '../utils/cookie.util';
import { csrfMatches, csrfTokenFor } from '../utils/token.util';

async function openEventDto(
  event: Event,
  attendeeCount: number,
  rsvpDeadlinePassed: boolean
): Promise<OpenEventDto & PresentationExtras> {
  const [contact, extras] = await Promise.all([
    hostRepository.findPublicContactByEventId(event.id),
    invitePresentationService.extras(event),
  ]);
  return {
    ...toOpenEventDto(
      event,
      contact ?? { name: event.hostName, email: event.hostEmail, phone: null, avatarUrl: null },
      { rsvpDeadlinePassed, attendeeCount }
    ),
    ...extras,
  };
}

function viewerDto(viewer: PublicEventViewer | null): Record<string, unknown> | null {
  if (!viewer) return null;
  return {
    name: viewer.name,
    email: viewer.email,
    phone: viewer.phone,
    has_birth_date: viewer.hasBirthDate,
    rsvp_status: viewer.rsvpStatus,
  };
}

/**
 * Só usa a conta para confirmar quando o pedido traz o CSRF derivado da
 * sessão: um site terceiro não consegue confirmar em nome da conta.
 */
async function accountForWrite(req: Request): Promise<AccountIdentity | null> {
  const account = await resolveAccountIdentity(req);
  if (!account) return null;
  const received = readCsrfHeader(req);
  return received && csrfMatches(csrfTokenFor(account.sessionToken), received) ? account : null;
}

export const publicEventController = {
  get: async (req: Request, res: Response): Promise<void> => {
    const account = await resolveAccountIdentity(req);
    const view = await publicEventService.view(req.params.slug ?? '', account);

    res.status(200).json({
      data: {
        event: await openEventDto(view.event, view.attendeeCount, view.rsvpDeadlinePassed),
        viewer: viewerDto(view.viewer),
        csrf_token: account ? csrfTokenFor(account.sessionToken) : null,
      },
    });
  },

  rsvp: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as PublicEventRsvpBody;
    const slug = req.params.slug ?? '';

    // Honeypot preenchido: responde como sucesso, sem gravar nada.
    if (body.website && body.website.trim() !== '') {
      const view = await publicEventService.view(slug, null);
      res.status(200).json({
        data: {
          event: await openEventDto(view.event, view.attendeeCount, view.rsvpDeadlinePassed),
          rsvp: { name: body.name ?? '', status: body.status, responded_at: new Date().toISOString() },
        },
      });
      return;
    }

    const account = await accountForWrite(req);
    const result = await publicEventService.rsvp(slug, body, account);

    res.status(200).json({
      data: {
        event: await openEventDto(result.event, result.attendeeCount, isRsvpDeadlinePassed(result.event)),
        rsvp: {
          name: result.invitation.guestName,
          status: result.invitation.rsvpStatus,
          responded_at: result.invitation.rsvpRespondedAt?.toISOString() ?? null,
        },
      },
    });
  },
};
