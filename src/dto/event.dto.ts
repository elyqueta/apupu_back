import { Event, EventStats } from '../types/event.types';
import { HostPublicContact } from '../types/host.types';
import { links } from '../utils/links.util';

/**
 * DTOs explícitos.
 *
 * A conversão para snake_case e a seleção de campos acontecem aqui,
 * não nos controllers. Isto garante que:
 * - o contrato da API não muda quando os tipos internos mudam;
 * - campos internos (hashes, segredos) nunca são serializados por
 *   acidente.
 */

export interface ContributionDto {
  enabled: boolean;
  bank_name?: string | null;
  account_holder?: string | null;
  account_reference?: string | null;
}

export interface EventLocationDto {
  type: string;
  name: string | null;
  address: string | null;
  online_url: string | null;
  latitude: number | null;
  longitude: number | null;
  place_label: string | null;
}

export interface EventThemeDto {
  mode: string;
  palette: string;
}

export interface EventDto {
  id: string;
  title: string;
  host_name: string;
  host_email: string;
  category: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  location: EventLocationDto;
  message: string | null;
  rules: string | null;
  dress_code: string | null;
  template_id: string | null;
  cover_url: string | null;
  theme: EventThemeDto;
  contribution: ContributionDto;
  rsvp_deadline: string | null;
  status: string;
  /** `private` (só convites individuais) ou `public` (link aberto). */
  visibility: 'public' | 'private';
  /** Link aberto do evento; `null` quando o evento é privado. */
  public_url: string | null;
  show_attendee_count: boolean;
  /** Limites de idade: só na vista de gestão, nunca em respostas públicas. */
  min_age: number | null;
  max_age: number | null;
  /** Comunidade do evento (Bloco 11); `null` = evento pessoal. */
  community_id: string | null;
  /** Bloco 14: vídeo (só o ID) e mesas. */
  youtube_video_id: string | null;
  use_tables: boolean;
  /** Papel de quem consulta: `host` ou `manager`. */
  access_role?: 'host' | 'manager';
  created_at: string;
  updated_at: string;
  stats?: {
    total_invitations: number;
    accepted: number;
    declined: number;
    pending: number;
  };
}

export type PublicEventDto = Omit<
  EventDto,
  | 'host_email'
  | 'template_id'
  | 'created_at'
  | 'updated_at'
  | 'stats'
  | 'access_role'
  | 'visibility'
  | 'public_url'
  | 'show_attendee_count'
  | 'min_age'
  | 'max_age'
  | 'community_id'
  | 'use_tables'
> & {
  /** Contacto controlado: email é sempre visível; telefone/avatar só se preenchidos. */
  host_email: string;
  host_phone: string | null;
  host_avatar_url: string | null;
};

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function contributionDto(event: Event): ContributionDto {
  if (!event.contribution.enabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    bank_name: event.contribution.bankName,
    account_holder: event.contribution.accountHolder,
    account_reference: event.contribution.accountReference,
  };
}

/** Vista de gestão: inclui dados de contacto do anfitrião. */
export function toEventDto(
  event: Event,
  stats?: EventStats,
  accessRole?: 'host' | 'manager'
): EventDto {
  return {
    id: event.id,
    title: event.title,
    host_name: event.hostName,
    host_email: event.hostEmail,
    category: event.category,
    starts_at: iso(event.startsAt),
    ends_at: iso(event.endsAt),
    timezone: event.timezone,
    location: {
      type: event.location.type,
      name: event.location.name,
      address: event.location.address,
      online_url: event.location.onlineUrl,
      latitude: event.location.latitude ?? null,
      longitude: event.location.longitude ?? null,
      place_label: event.location.placeLabel ?? null,
    },
    message: event.message,
    rules: event.rules,
    dress_code: event.dressCode,
    template_id: event.templateId,
    cover_url: event.coverUrl,
    theme: {
      mode: event.theme.mode,
      palette: event.theme.palette,
    },
    contribution: contributionDto(event),
    rsvp_deadline: iso(event.rsvpDeadline),
    status: event.status,
    visibility: event.visibility,
    public_url:
      event.visibility === 'public' && event.publicSlug ? links.publicEvent(event.publicSlug) : null,
    show_attendee_count: event.showAttendeeCount,
    min_age: event.minAge,
    max_age: event.maxAge,
    community_id: event.communityId,
    youtube_video_id: event.youtubeVideoId ?? null,
    use_tables: event.useTables ?? false,
    ...(accessRole ? { access_role: accessRole } : {}),
    created_at: event.createdAt.toISOString(),
    updated_at: event.updatedAt.toISOString(),
    ...(stats
      ? {
          stats: {
            total_invitations: stats.totalInvitations,
            accepted: stats.accepted,
            declined: stats.declined,
            pending: stats.pending,
          },
        }
      : {}),
  };
}

/**
 * Vista pública: contacto mínimo do anfitrião, sem segredos, sem
 * estatísticas de RSVP de terceiros e sem outros dados do perfil.
 */
export function toPublicEventDto(
  event: Event,
  hostContact: HostPublicContact
): PublicEventDto {
  return {
    id: event.id,
    title: event.title,
    host_name: hostContact.name,
    host_email: hostContact.email,
    host_phone: hostContact.phone,
    host_avatar_url: hostContact.avatarUrl,
    category: event.category,
    starts_at: iso(event.startsAt),
    ends_at: iso(event.endsAt),
    timezone: event.timezone,
    location: {
      type: event.location.type,
      name: event.location.name,
      address: event.location.address,
      online_url: event.location.onlineUrl,
      latitude: event.location.latitude ?? null,
      longitude: event.location.longitude ?? null,
      place_label: event.location.placeLabel ?? null,
    },
    message: event.message,
    rules: event.rules,
    dress_code: event.dressCode,
    cover_url: event.coverUrl,
    theme: {
      mode: event.theme.mode,
      palette: event.theme.palette,
    },
    contribution: contributionDto(event),
    rsvp_deadline: iso(event.rsvpDeadline),
    status: event.status,
    youtube_video_id: event.youtubeVideoId ?? null,
  };
}

/**
 * Evento aberto (`GET /public/events/:slug`): o mesmo DTO seguro do
 * convite, sem convidados e sem limites de idade. `attendee_count` só
 * existe na resposta quando o anfitrião o tornou público.
 */
export type OpenEventDto = PublicEventDto & {
  slug: string;
  has_age_restriction: boolean;
  rsvp_deadline_passed: boolean;
  attendee_count?: number;
};

export function toOpenEventDto(
  event: Event,
  hostContact: HostPublicContact,
  options: { rsvpDeadlinePassed: boolean; attendeeCount: number }
): OpenEventDto {
  return {
    ...toPublicEventDto(event, hostContact),
    slug: event.publicSlug ?? '',
    has_age_restriction: event.minAge !== null || event.maxAge !== null,
    rsvp_deadline_passed: options.rsvpDeadlinePassed,
    ...(event.showAttendeeCount ? { attendee_count: options.attendeeCount } : {}),
  };
}
