import { parseManifest, TemplateManifest } from '../types/templateManifest';
import { logger } from '../config/logger';
import { Event } from '../types/event.types';
import { HostPublicContact } from '../types/host.types';
import { AccountInvitation, Invitation, InvitationWithEvent } from '../types/invitation.types';
import { EmailDelivery } from '../types/emailDelivery.types';
import { EventTemplate } from '../types/template.types';
import { decryptToken } from '../utils/crypto.util';
import { effectiveEventStatus } from '../utils/eventStatus.util';
import { links } from '../utils/links.util';
import { EventLocationDto, PublicEventDto, toPublicEventDto } from './event.dto';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export interface InvitationDto {
  id: string;
  event_id: string;
  guest_name: string;
  /** `null` em confirmações pelo link aberto feitas só com telefone. */
  guest_email: string | null;
  guest_phone: string | null;
  /** `personal` (convite individual) ou `public_link` (link aberto do evento). */
  source: 'personal' | 'public_link';
  /** Idade indicada na confirmação pelo link aberto (só organizadores). */
  guest_age: number | null;
  /** Selo "Idade alterada": a data de nascimento mudou e passou a cumprir os limites. */
  age_flag: boolean;
  age_flag_reason: 'birth_date_changed' | null;
  table_name: string | null;
  /** Mensagem opcional deixada ao responder (texto simples, até 500 caracteres). */
  guest_message: string | null;
  /** Resposta do anfitrião (visível também no convite público). */
  message_answer: string | null;
  message_answered_at: string | null;
  message_read_at: string | null;
  rsvp_status: string;
  rsvp_responded_at: string | null;
  send_status: string;
  send_count: number;
  last_sent_at: string | null;
  /**
   * Última vez que o anfitrião abriu o WhatsApp com o link deste convite.
   * Não significa que a mensagem tenha sido enviada ou lida.
   */
  whatsapp_shared_at: string | null;
  whatsapp_share_count: number;
  /**
   * Primeira vez que o convidado abriu o link do convite.
   *
   * `null` enquanto o link nunca foi aberto. A partir daqui o anfitrião
   * deixa de poder alterar o email e o telefone do convidado.
   */
  opened_at: string | null;
  /**
   * URL absoluto para o anfitrião partilhar (WhatsApp, etc.).
   *
   * `null` quando o convite foi revogado ou o token não pode ser
   * reconstruído. Nunca aparece em respostas públicas.
   */
  invitation_url: string | null;
  /**
   * Fim da validade do link de partilha: por defeito, fim do evento + 1 dia.
   * Depois dessa data o link devolve o mesmo 404 genérico de um link inválido.
   */
  invitation_url_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Reconstrói o link partilhável a partir do token cifrado.
 *
 * Uma falha de decifra (por exemplo, `TOKEN_PEPPER` alterado) não deve
 * derrubar a listagem: o convite continua visível e o anfitrião pode
 * reenviá-lo por email, mas sem URL para partilhar.
 */
function invitationUrl(invitation: Invitation): string | null {
  if (invitation.claimRevokedAt || !invitation.tokenEncrypted) {
    return null;
  }

  try {
    return links.invitation(decryptToken(invitation.tokenEncrypted));
  } catch (error) {
    logger.error(
      { err: error, invitationId: invitation.id },
      'Falha ao reconstruir o link do convite.'
    );
    return null;
  }
}

/** Vista de gestão de um convite — sem hashes nem capacidades do convidado. */
export function toInvitationDto(invitation: Invitation): InvitationDto {
  return {
    id: invitation.id,
    event_id: invitation.eventId,
    guest_name: invitation.guestName,
    guest_email: invitation.guestEmail,
    guest_phone: invitation.guestPhone,
    source: invitation.source,
    guest_age: invitation.guestAge,
    age_flag: invitation.ageFlag,
    age_flag_reason: invitation.ageFlagReason,
    table_name: invitation.tableName,
    guest_message: invitation.guestMessage,
    message_answer: invitation.messageAnswer,
    message_answered_at: iso(invitation.messageAnsweredAt),
    message_read_at: iso(invitation.messageReadAt),
    rsvp_status: invitation.rsvpStatus,
    rsvp_responded_at: iso(invitation.rsvpRespondedAt),
    send_status: invitation.sendStatus,
    send_count: invitation.sendCount,
    last_sent_at: iso(invitation.lastSentAt),
    whatsapp_shared_at: iso(invitation.whatsappSharedAt),
    whatsapp_share_count: invitation.whatsappShareCount,
    opened_at: iso(invitation.claimedAt),
    invitation_url: invitationUrl(invitation),
    invitation_url_expires_at: iso(invitation.linkExpiresAt),
    created_at: invitation.createdAt.toISOString(),
    updated_at: invitation.updatedAt.toISOString(),
  };
}

export interface EventSummaryDto {
  id: string;
  title: string;
  starts_at: string | null;
  status: string;
}

export interface HostGuestDto extends InvitationDto {
  event: EventSummaryDto;
}

/** Lista global de convidados: convite + resumo do evento. */
export function toHostGuestDto(invitation: InvitationWithEvent): HostGuestDto {
  return {
    ...toInvitationDto(invitation),
    event: {
      id: invitation.eventId,
      title: invitation.eventTitle,
      starts_at: iso(invitation.eventStartsAt),
      status: invitation.eventStatus,
    },
  };
}

export interface GuestEventSummaryDto {
  id: string;
  title: string;
  host_name: string;
  starts_at: string | null;
  timezone: string;
  status: string;
  category: string | null;
  template_id: string | null;
  cover_url: string | null;
  location: EventLocationDto;
}

/**
 * "Meus convites": o próprio convite + resumo público do evento.
 *
 * Não inclui nome/email/telefone do convidado (nem de terceiros),
 * estado de envio, contagens, contribuições ou notas privadas.
 */
export interface GuestInvitationDto {
  id: string;
  event_id: string;
  rsvp_status: string;
  rsvp_responded_at: string | null;
  table_name: string | null;
  invitation_url: string | null;
  invitation_url_expires_at: string | null;
  created_at: string;
  event: GuestEventSummaryDto;
}

/** Vista da conta convidada ("Meus convites"). */
export function toGuestInvitationDto(invitation: AccountInvitation): GuestInvitationDto {
  const status = effectiveEventStatus({
    status: invitation.eventStatus,
    startsAt: invitation.eventStartsAt,
    endsAt: invitation.eventEndsAt,
    timezone: invitation.eventTimezone,
  });
  return {
    id: invitation.id,
    event_id: invitation.eventId,
    rsvp_status: invitation.rsvpStatus,
    rsvp_responded_at: iso(invitation.rsvpRespondedAt),
    table_name: invitation.tableName,
    invitation_url: invitationUrl(invitation),
    invitation_url_expires_at: iso(invitation.linkExpiresAt),
    created_at: invitation.createdAt.toISOString(),
    event: {
      id: invitation.eventId,
      title: invitation.eventTitle,
      host_name: invitation.eventHostName,
      starts_at: iso(invitation.eventStartsAt),
      timezone: invitation.eventTimezone,
      status,
      category: invitation.eventCategory,
      template_id: invitation.eventTemplateId,
      cover_url: invitation.eventCoverUrl,
      location: {
        type: invitation.eventLocation.type,
        name: invitation.eventLocation.name,
        address: invitation.eventLocation.address,
        online_url: invitation.eventLocation.onlineUrl,
        latitude: invitation.eventLocation.latitude ?? null,
        longitude: invitation.eventLocation.longitude ?? null,
        place_label: invitation.eventLocation.placeLabel ?? null,
      },
    },
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
    email: string | null;
    /** `true` quando o email do convite já tem conta registada. */
    email_has_account: boolean;
    rsvp_status: string;
    rsvp_responded_at: string | null;
    /** Texto simples deixado pelo próprio convidado ao responder. */
    message: string | null;
    /** Resposta do anfitrião à mensagem (Parte F). */
    message_answer: string | null;
    message_answered_at: string | null;
  };
  rsvp_deadline_passed: boolean;
}

/** Apresentação pública do convite: apenas os dados do próprio convidado. */
export function toPublicInvitationDto(
  event: Event,
  invitation: Invitation,
  rsvpDeadlinePassed: boolean,
  emailHasAccount: boolean,
  hostContact: HostPublicContact
): PublicInvitationDto {
  return {
    event: toPublicEventDto(event, hostContact),
    guest: {
      name: invitation.guestName,
      email: invitation.guestEmail,
      email_has_account: emailHasAccount,
      rsvp_status: invitation.rsvpStatus,
      rsvp_responded_at: iso(invitation.rsvpRespondedAt),
      message: invitation.guestMessage,
      message_answer: invitation.messageAnswer,
      message_answered_at: iso(invitation.messageAnsweredAt),
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
  kind: 'system' | 'user';
  /** Bloco 14: manifesto validado (cai no neutro se inválido). */
  manifest: TemplateManifest;
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
    kind: template.kind ?? 'user',
    manifest: parseManifest(template.manifest),
  };
}
