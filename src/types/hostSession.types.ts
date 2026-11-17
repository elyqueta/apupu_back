/** Tipos de sessão de gestão. */

import { EventAccessRole } from './event.types';

export interface HostSession {
  id: string;
  eventId: string;
  tokenHash: string;
  /** Anfitrião ou gestor. */
  role: EventAccessRole;
  /** Gestor associado quando `role = manager`. */
  managerId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}
