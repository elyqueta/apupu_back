/** Tipos de gestores de evento. */

import { EventStatus } from './event.types';

export interface EventManager {
  id: string;
  eventId: string;
  email: string;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** `true` quando existe uma conta verificada com o mesmo email. */
  hasAccount: boolean;
}

/**
 * Gestor visto na página global de equipas: inclui o evento a que está
 * associado para que o anfitrião possa gerir todos os gestores num só
 * sítio.
 */
export interface HostEventManager extends EventManager {
  eventTitle: string;
  eventStartsAt: Date | null;
  eventStatus: EventStatus;
}
