import { Event, EventStats } from '../types/event.types';

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
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  location: EventLocationDto;
  message: string | null;
  rules: string | null;
  dress_code: string | null;
  template_id: string | null;
  theme: EventThemeDto;
  contribution: ContributionDto;
  rsvp_deadline: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  stats?: {
    total_invitations: number;
    accepted: number;
    declined: number;
    pending: number;
  };
}

export type PublicEventDto = Omit<EventDto, 'host_email' | 'template_id' | 'created_at' | 'updated_at' | 'stats'>;

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
export function toEventDto(event: Event, stats?: EventStats): EventDto {
  return {
    id: event.id,
    title: event.title,
    host_name: event.hostName,
    host_email: event.hostEmail,
    starts_at: iso(event.startsAt),
    ends_at: iso(event.endsAt),
    timezone: event.timezone,
    location: {
      type: event.location.type,
      name: event.location.name,
      address: event.location.address,
      online_url: event.location.onlineUrl,
    },
    message: event.message,
    rules: event.rules,
    dress_code: event.dressCode,
    template_id: event.templateId,
    theme: {
      mode: event.theme.mode,
      palette: event.theme.palette,
    },
    contribution: contributionDto(event),
    rsvp_deadline: iso(event.rsvpDeadline),
    status: event.status,
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
 * Vista pública: sem email do anfitrião, sem segredos, sem
 * estatísticas de RSVP de terceiros.
 */
export function toPublicEventDto(event: Event): PublicEventDto {
  return {
    id: event.id,
    title: event.title,
    host_name: event.hostName,
    starts_at: iso(event.startsAt),
    ends_at: iso(event.endsAt),
    timezone: event.timezone,
    location: {
      type: event.location.type,
      name: event.location.name,
      address: event.location.address,
      online_url: event.location.onlineUrl,
    },
    message: event.message,
    rules: event.rules,
    dress_code: event.dressCode,
    theme: {
      mode: event.theme.mode,
      palette: event.theme.palette,
    },
    contribution: contributionDto(event),
    rsvp_deadline: iso(event.rsvpDeadline),
    status: event.status,
  };
}
