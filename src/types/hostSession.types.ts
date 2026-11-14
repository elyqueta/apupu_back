/** Tipos de sessão de gestão. */

export interface HostSession {
  id: string;
  eventId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}
