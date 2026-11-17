/** Tipos do domínio de convites. */

import { EventCategory, EventLocation, EventStatus } from './event.types';

export const RSVP_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const SEND_STATUSES = ['pending', 'queued', 'sent', 'failed'] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export interface Invitation {
  id: string;
  eventId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  tableName: string | null;
  tokenHash: string;
  tokenEncrypted: string;
  claimHash: string | null;
  claimedAt: Date | null;
  claimRevokedAt: Date | null;
  rsvpStatus: RsvpStatus;
  rsvpRespondedAt: Date | null;
  rsvpVersion: number;
  sendStatus: SendStatus;
  sendCount: number;
  lastSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvitationInput {
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  tableName: string | null;
}

export interface UpdateInvitationInput {
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string | null;
  tableName?: string | null;
}

/** Convite com o resumo do evento, usado na lista global de convidados. */
export interface InvitationWithEvent extends Invitation {
  eventTitle: string;
  eventStartsAt: Date;
  eventStatus: string;
}

/**
 * Convite visto pela conta convidada ("Meus convites").
 *
 * A associação é feita por email (`invitations.guest_email` =
 * `hosts.email`), por isso o registo traz também o resumo público do
 * evento — nunca outros convidados nem dados internos do anfitrião.
 */
export interface AccountInvitation extends Invitation {
  eventTitle: string;
  eventHostName: string;
  eventStartsAt: Date;
  eventTimezone: string;
  eventStatus: EventStatus;
  eventCategory: EventCategory | null;
  eventTemplateId: string | null;
  eventLocation: EventLocation;
}

export interface RsvpInput {
  status: Exclude<RsvpStatus, 'pending'>;
}
