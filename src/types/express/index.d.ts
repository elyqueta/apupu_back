import { Event } from '../event.types';
import { Invitation } from '../invitation.types';

/**
 * Extensões ao Request do Express.
 *
 * - `id`: identificador de correlação do pedido (requestId).
 * - `event`: evento resolvido por uma sessão de gestão válida.
 * - `invitation`: convite resolvido pela capacidade de navegador.
 * - `hostSession`: sessão de gestão autenticada.
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
    }
  }
}

export {};
