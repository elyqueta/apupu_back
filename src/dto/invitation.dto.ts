import { Event } from '../types/event.types';
import { Invitation } from '../types/invitation.types';
import { EmailDelivery } from '../types/emailDelivery.types';
import { EventTemplate } from '../types/template.types';
import { PublicEventDto, toPublicEventDto } from './event.dto';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export interface InvitationDto {
  id: string;
  event_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  rsvp_status: string;
  rsvp_responded_at: string | null;
  send_status: string;
  send_count: number;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Vista de gestão de um convite — sem hashes nem tokens. */
export function toInvitationDto(invitation: Invitation): InvitationDto {
  return {
    id: invitation.id,
    event_id: invitation.eventId,
    guest_name: invitation.guestName,
    guest_email: invitation.guestEmail,
    guest_phone: invitation.guestPhone,
    rsvp_status: invitation.rsvpStatus,
    rsvp_responded_at: iso(invitation.rsvpRespondedAt),
    send_status: invitation.sendStatus,
    send_count: invitation.sendCount,
    last_sent_at: iso(invitation.lastSentAt),
    created_at: invitation.createdAt.toISOString(),
    updated_at: invitation.updatedAt.toISOString(),
  };
}

export interface DeliveryStatusDto {
  delivery_id: string | null;
  status: string;
}

/** Estado de enfileiramento por destinatário na criação do evento. */
export function toDeliveryStatusDto(delivery: EmailDelivery | null): DeliveryStatusDto {
  return {
    delivery_id: delivery?.id ?? null,
    status: delivery?.status ?? 'pending',
  };
}

export interface PublicInvitationDto {
  event: PublicEventDto;
  guest: {
    name: string;
    rsvp_status: string;
    rsvp_responded_at: string | null;
  };
  rsvp_deadline_passed: boolean;
}

/** Apresentação pública do convite: apenas os dados do próprio convidado. */
export function toPublicInvitationDto(
  event: Event,
  invitation: Invitation,
  rsvpDeadlinePassed: boolean
): PublicInvitationDto {
  return {
    event: toPublicEventDto(event),
    guest: {
      name: invitation.guestName,
      rsvp_status: invitation.rsvpStatus,
      rsvp_responded_at: iso(invitation.rsvpRespondedAt),
    },
    rsvp_deadline_passed: rsvpDeadlinePassed,
  };
}

export interface TemplateDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  preview_image_url: string | null;
  supported_fields: string[];
  themes: Array<{ mode: string; palette: string }>;
  is_active: boolean;
}

export function toTemplateDto(template: EventTemplate): TemplateDto {
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    description: template.description,
    preview_image_url: template.previewImageUrl,
    supported_fields: template.supportedFields,
    themes: template.themes,
    is_active: template.isActive,
  };
}
