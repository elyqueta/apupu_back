import { Event } from '../event.types';
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
    interface Request {
      id: string;
      event?: Event;
      invitation?: Invitation;
      hostSession?: {
        id: string;
        eventId: string;
        expiresAt: Date;
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
