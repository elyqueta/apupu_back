import { EventManager } from '../types/eventManager.types';

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
