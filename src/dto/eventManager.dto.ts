import { EventManager, HostEventManager } from '../types/eventManager.types';

/**
 * Gestor de evento exposto ao anfitrião.
 *
 * O hash/segredo do link nunca é serializado. `has_account` indica se
 * já existe uma conta verificada com o mesmo email, para o painel
 * explicar onde o evento aparece.
 */
export interface EventManagerDto {
  id: string;
  event_id: string;
  email: string;
  has_account: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toEventManagerDto(manager: EventManager): EventManagerDto {
  return {
    id: manager.id,
    event_id: manager.eventId,
    email: manager.email,
    has_account: manager.hasAccount,
    last_used_at: iso(manager.lastUsedAt),
    created_at: manager.createdAt.toISOString(),
    updated_at: manager.updatedAt.toISOString(),
  };
}

/** Gestor na página global de equipas, com o evento a que pertence. */
export interface HostEventManagerDto extends EventManagerDto {
  event: {
    id: string;
    title: string;
    starts_at: string | null;
    status: string;
  };
}

export function toHostEventManagerDto(manager: HostEventManager): HostEventManagerDto {
  return {
    ...toEventManagerDto(manager),
    event: {
      id: manager.eventId,
      title: manager.eventTitle,
      starts_at: iso(manager.eventStartsAt),
      status: manager.eventStatus,
    },
  };
}
