import { withTransaction } from '../database/pool';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { activityRepository } from '../repositories/activity.repository';
import { eventRepository } from '../repositories/event.repository';
import { hostBirthDateChangeRepository } from '../repositories/hostBirthDateChange.repository';
import { hostRepository } from '../repositories/host.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { PublicEventRsvpBody } from '../schemas/invitation.schemas';
import { Event } from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import { ageFromBirthDate, ageWithinLimits, hasAgeRestriction } from '../utils/age.util';
import { encryptToken } from '../utils/crypto.util';
import { isUniqueViolation } from '../utils/db.util';
import { normalizeAngolanPhone } from '../utils/phone.util';
import { generateToken, hashToken } from '../utils/token.util';
import { AccountIdentity } from './guestAccess.service';
import { isRsvpDeadlinePassed } from './invitation.service';
import { linkValidityService } from './linkValidity.service';
import {
  cancelMessagesForInvitation,
  enqueueRemindersForInvitation,
} from './reminder.service';

/** Mesmo 404 para slug inexistente, evento privado, removido ou em rascunho. */
const PUBLIC_EVENT_NOT_FOUND = 'Evento não encontrado.';

/**
 * Recusa genérica: idêntica para qualquer motivo ligado à idade (abaixo
 * do mínimo, acima do máximo). Nunca revela os limites.
 */
export const PUBLIC_RSVP_REFUSED_MESSAGE = 'Não foi possível confirmar a sua presença neste evento.';
export const PUBLIC_RSVP_REFUSED_CODE = 'public_rsvp_refused';

export const AGE_PROFILE_REQUIRED_MESSAGE =
  'Este evento tem restrição de idade. Indique a sua data de nascimento no perfil.';

function refuse(): never {
  throw new ForbiddenError(PUBLIC_RSVP_REFUSED_MESSAGE, PUBLIC_RSVP_REFUSED_CODE);
}

/** Dados da conta usados para pré-preencher e confirmar com um clique. */
export interface PublicEventViewer {
  name: string;
  email: string;
  phone: string | null;
  hasBirthDate: boolean;
  rsvpStatus: Invitation['rsvpStatus'] | null;
}

export interface PublicEventView {
  event: Event;
  attendeeCount: number;
  rsvpDeadlinePassed: boolean;
  viewer: PublicEventViewer | null;
}

export interface PublicRsvpResult {
  event: Event;
  attendeeCount: number;
  invitation: Pick<Invitation, 'guestName' | 'rsvpStatus' | 'rsvpRespondedAt'>;
}

async function loadPublicEvent(slug: string): Promise<Event> {
  const event = await eventRepository.findByPublicSlug(slug);

  if (!event || event.status === 'draft') {
    throw new NotFoundError(PUBLIC_EVENT_NOT_FOUND, 'public_event_not_found');
  }

  return event;
}

function isEventOver(event: Event): boolean {
  const end = event.endsAt ?? event.startsAt;
  return end.getTime() <= Date.now();
}

function assertEventOpen(event: Event): void {
  if (event.status === 'cancelled') {
    throw new ConflictError(
      'Este evento foi cancelado. Já não é possível fazer alterações.',
      'event_cancelled'
    );
  }

  if (event.status === 'completed' || isEventOver(event)) {
    throw new ConflictError('Este evento já terminou.', 'event_completed');
  }

  if (isRsvpDeadlinePassed(event)) {
    throw new ConflictError('O prazo de resposta deste evento já terminou.', 'rsvp_deadline_passed');
  }
}

interface ResolvedGuest {
  name: string;
  email: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  age: number | null;
  ageFlag: boolean;
}

/**
 * Identidade de quem confirma. A conta tem prioridade e os seus dados
 * são só de leitura; a idade é calculada no servidor (Luanda).
 */
async function resolveGuest(
  event: Event,
  body: PublicEventRsvpBody,
  account: AccountIdentity | null
): Promise<ResolvedGuest> {
  const restricted = hasAgeRestriction(event);
  const accepting = body.status === 'accepted';

  if (account) {
    const host = await hostRepository.findById(account.hostId);
    if (!host || host.status !== 'active') {
      throw new NotFoundError(PUBLIC_EVENT_NOT_FOUND, 'public_event_not_found');
    }

    const phoneNormalized = host.profile.phone ? normalizeAngolanPhone(host.profile.phone) : null;
    const birthDate = host.profile.birthDate;
    let age: number | null = null;
    let ageFlag = false;

    if (restricted && accepting) {
      if (!birthDate) {
        throw new ValidationError(
          AGE_PROFILE_REQUIRED_MESSAGE,
          { birth_date: [AGE_PROFILE_REQUIRED_MESSAGE] },
          'age_profile_required'
        );
      }

      age = ageFromBirthDate(birthDate);
      if (age === null || !ageWithinLimits(age, event)) refuse();

      // Com um valor anterior a pessoa não cumpria e agora cumpre:
      // a confirmação passa, mas fica marcada para os organizadores.
      const previous = await hostBirthDateChangeRepository.previousValues(account.hostId);
      ageFlag = previous.some((value) => {
        const previousAge = ageFromBirthDate(value);
        return previousAge !== null && !ageWithinLimits(previousAge, event);
      });
    }

    return {
      name: host.profile.displayName?.trim() || host.email,
      email: host.email,
      phone: host.profile.phone,
      phoneNormalized,
      age,
      ageFlag,
    };
  }

  const name = body.name?.trim() ?? '';
  if (name.length < 2) {
    throw new ValidationError('Verifique os campos indicados.', {
      name: ['Indique o seu nome (2 a 120 caracteres).'],
    });
  }

  const email = body.email ?? null;
  const phoneNormalized = body.phone ? normalizeAngolanPhone(body.phone) : null;

  if (body.phone && !phoneNormalized) {
    throw new ValidationError('Verifique os campos indicados.', {
      phone: ['Indique um telefone angolano válido.'],
    });
  }

  if (!email && !phoneNormalized) {
    throw new ValidationError('Verifique os campos indicados.', {
      contact: ['Indique um email ou um telefone.'],
    });
  }

  let age: number | null = null;
  if (restricted && accepting) {
    if (body.age === undefined) {
      throw new ValidationError('Verifique os campos indicados.', {
        age: ['Indique a sua idade.'],
      });
    }
    age = body.age;
    if (!ageWithinLimits(age, event)) refuse();
  }

  return {
    name,
    email,
    phone: phoneNormalized,
    phoneNormalized,
    age,
    ageFlag: false,
  };
}

export const publicEventService = {
  async view(slug: string, account: AccountIdentity | null): Promise<PublicEventView> {
    const event = await loadPublicEvent(slug);
    const attendeeCount = event.showAttendeeCount
      ? await eventRepository.countAccepted(event.id)
      : 0;

    let viewer: PublicEventViewer | null = null;
    if (account) {
      const host = await hostRepository.findById(account.hostId);
      if (host && host.status === 'active') {
        const existing = await withTransaction((client) =>
          invitationRepository.findByContactForUpdate(
            event.id,
            {
              email: host.email,
              phoneNormalized: host.profile.phone
                ? normalizeAngolanPhone(host.profile.phone)
                : null,
            },
            client
          )
        );
        viewer = {
          name: host.profile.displayName?.trim() || host.email,
          email: host.email,
          phone: host.profile.phone,
          hasBirthDate: Boolean(host.profile.birthDate),
          rsvpStatus: existing?.rsvpStatus ?? null,
        };
      }
    }

    return {
      event,
      attendeeCount,
      rsvpDeadlinePassed: isRsvpDeadlinePassed(event),
      viewer,
    };
  },

  /**
   * Confirma presença pelo link aberto.
   *
   * O mesmo contacto no mesmo evento actualiza a resposta existente
   * (idempotente). Um contacto que já tem convite individual é recusado
   * com uma indicação para usar esse link, para que o link aberto nunca
   * altere a resposta de um convite pessoal.
   */
  async rsvp(
    slug: string,
    body: PublicEventRsvpBody,
    account: AccountIdentity | null,
    attempt = 0
  ): Promise<PublicRsvpResult> {
    const event = await loadPublicEvent(slug);
    assertEventOpen(event);

    const guest = await resolveGuest(event, body, account);

    // Como nos convites individuais, o anfitrião não responde ao próprio evento.
    if (guest.email && guest.email.trim().toLowerCase() === event.hostEmail.trim().toLowerCase()) {
      throw new ConflictError(
        'O anfitrião não pode responder ao próprio evento.',
        'public_rsvp_host'
      );
    }
    const message = body.message ?? null;
    const linkExpiresAt = await linkValidityService.maximumFor(event);

    try {
      return await withTransaction(async (client) => {
        const locked = await eventRepository.findByIdForUpdate(event.id, client);
        if (!locked || locked.visibility !== 'public') {
          throw new NotFoundError(PUBLIC_EVENT_NOT_FOUND, 'public_event_not_found');
        }
        assertEventOpen(locked);

        const existing = await invitationRepository.findByContactForUpdate(
          event.id,
          { email: guest.email, phoneNormalized: guest.phoneNormalized },
          client
        );

        if (existing && existing.source !== 'public_link') {
          throw new ConflictError(
            'Este contacto já tem um convite individual para este evento. Use o link que recebeu.',
            'public_rsvp_personal_invite'
          );
        }

        const ageFlagReason = guest.ageFlag ? ('birth_date_changed' as const) : null;
        let invitation: Invitation;
        let changed = true;

        if (existing) {
          changed = existing.rsvpStatus !== body.status;
          const updated = await invitationRepository.updatePublicResponse(
            existing.id,
            {
              guestName: guest.name,
              guestAge: guest.age,
              ageFlag: guest.ageFlag,
              ageFlagReason,
              status: body.status,
              message,
            },
            client
          );
          if (!updated) {
            throw new NotFoundError(PUBLIC_EVENT_NOT_FOUND, 'public_event_not_found');
          }
          invitation = updated;
        } else {
          const token = generateToken();
          invitation = await invitationRepository.createPublic(
            {
              eventId: event.id,
              guestName: guest.name,
              guestEmail: guest.email,
              guestPhone: guest.phone,
              guestPhoneNormalized: guest.phoneNormalized,
              guestAge: guest.age,
              ageFlag: guest.ageFlag,
              ageFlagReason,
              status: body.status,
              message,
              linkExpiresAt,
              tokenHash: hashToken(token),
              tokenEncrypted: encryptToken(token),
            },
            client
          );
        }

        if (changed) {
          if (body.status === 'declined') {
            await cancelMessagesForInvitation(invitation.id, client);
          } else {
            await enqueueRemindersForInvitation(locked, invitation, client, {
              keySuffix: `public:${invitation.rsvpVersion}`,
            });
          }

          await activityRepository.create(
            {
              eventId: event.id,
              invitationId: invitation.id,
              kind: body.status === 'accepted' ? 'rsvp_accepted' : 'rsvp_declined',
              guestName: invitation.guestName,
              metadata: {
                source: 'public_link',
                ...(invitation.guestMessage ? { guest_message: invitation.guestMessage } : {}),
                ...(guest.ageFlag ? { age_flag: true, age_flag_reason: ageFlagReason } : {}),
              },
            },
            client
          );
        }

        const attendeeCount = locked.showAttendeeCount
          ? await eventRepository.countAccepted(event.id, client)
          : 0;

        return {
          event: locked,
          attendeeCount,
          invitation: {
            guestName: invitation.guestName,
            rsvpStatus: invitation.rsvpStatus,
            rsvpRespondedAt: invitation.rsvpRespondedAt,
          },
        };
      });
    } catch (error) {
      // Duas confirmações simultâneas com o mesmo contacto: a segunda
      // repete o pedido e cai no caminho de actualização (idempotente).
      if (isUniqueViolation(error) && attempt === 0) {
        return this.rsvp(slug, body, account, attempt + 1);
      }
      throw error;
    }
  },
};
