/** Tipos de gestores de evento. */

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
