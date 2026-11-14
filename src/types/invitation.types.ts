/** Tipos do domínio de convites. */

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
}

export interface UpdateInvitationInput {
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string | null;
}

export interface RsvpInput {
  status: Exclude<RsvpStatus, 'pending'>;
}
