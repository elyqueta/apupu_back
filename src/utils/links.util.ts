import { env } from '../config/env';

/** Remove barras finais para evitar `//` nos links construídos. */
function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Links partilháveis do produto.
 *
 * O link de gestão é enviado por email; o frontend troca-o por uma
 * sessão em `POST /host/session`. O link de convite é individual.
 */
export const links = {
  /** Página de gestão do evento (link secreto do anfitrião). */
  manageEvent(token: string): string {
    return `${trimBase(env.APP_BASE_URL)}/gerir/${token}`;
  },

  /** Página pública do convite individual. */
  invitation(token: string): string {
    return `${trimBase(env.APP_BASE_URL)}/convite/${token}`;
  },

  /** Endpoint direto de RSVP da API (útil em clientes sem frontend). */
  rsvp(token: string): string {
    return `${trimBase(env.API_BASE_URL)}/api/v1/public/invitations/${token}/rsvp`;
  },
};
