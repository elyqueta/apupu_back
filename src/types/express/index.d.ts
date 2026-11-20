import type { GoogleProfile } from '../../config/passport.config';
import { Event, EventAccessRole } from '../event.types';
import { GuestAccess } from '../guestAccess.types';
import { Invitation } from '../invitation.types';
import { HostWithProfile } from '../host.types';

/**
 * Extensões ao Request do Express.
 *
 * Nota: `host` é uma propriedade nativa do Express (alias de
 * `hostname`, só de leitura), por isso a conta autenticada usa
 * `hostAccount`.
 *
 * - `id`: identificador de correlação do pedido (requestId).
 * - `event`: evento resolvido por uma sessão de gestão válida.
 * - `invitation`: convite resolvido pela capacidade de navegador.
 * - `hostSession`: sessão de gestão por evento (fluxo legado).
 * - `hostAccount`: conta autenticada (sessão de conta).
 * - `accountSession`: metadados da sessão de conta.
 */
declare global {
  namespace Express {
    /** Utilizador devolvido pela estratégia Google (ver passport.config.ts). */
    interface User extends GoogleProfile {
      /** Identificador do Google (`sub`). */
      id: string;
    }

    interface Request {
      id: string;
      event?: Event;
      invitation?: Invitation;
      /** Como o convite foi autorizado: capacidade do navegador ou conta. */
      guestAccess?: GuestAccess;
      hostSession?: {
        id: string;
        eventId: string;
        role: EventAccessRole;
        managerId: string | null;
        expiresAt: Date;
      };
      /** Papel resolvido para o evento do pedido. */
      accessRole?: EventAccessRole;
      /** Contacto já validado pela sessão de gestão (link + código). */
      managerContact?: {
        email: string | null;
        phone: string | null;
        displayName: string | null;
      };
      hostAccount?: HostWithProfile;
      accountSession?: {
        sessionId: string;
        expiresAt: Date;
      };
    }
  }
}

export {};
