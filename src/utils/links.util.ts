import { env } from '../config/env';

/** Remove barras finais para evitar `//` nos links construídos. */
function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/** `true` quando a URL aponta para a própria máquina. */
function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Base pública do frontend usada nos links enviados por email.
 *
 * `APP_BASE_URL` é a fonte de verdade. Se estiver configurada com um
 * endereço local (acontece ao copiar o `.env` de desenvolvimento para o
 * Render), usamos o primeiro `CORS_ORIGIN` público. Assim os emails
 * enviados a partir do frontend em produção nunca apontam para
 * `localhost`, mesmo que a variável de ambiente esteja errada.
 */
export function publicAppBaseUrl(): string {
  const configured = trimBase(env.APP_BASE_URL);
  if (!isLocalUrl(configured)) {
    return configured;
  }

  const publicOrigin = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .find((origin) => origin.length > 0 && !isLocalUrl(origin));

  return trimBase(publicOrigin ?? configured);
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
    return `${publicAppBaseUrl()}/gerir/${token}`;
  },

  /** Página pública do convite individual. */
  invitation(token: string): string {
    return `${publicAppBaseUrl()}/convite/${token}`;
  },

  /** Página de verificação de email da conta. */
  verifyEmail(token: string): string {
    return `${publicAppBaseUrl()}/verificar-email/${token}`;
  },

  /** Página de definição de nova palavra-passe. */
  resetPassword(token: string): string {
    const params = new URLSearchParams({ token });
    return `${publicAppBaseUrl()}/redefinir-senha?${params.toString()}`;
  },

  /** Página de login da conta. */
  login(): string {
    return `${publicAppBaseUrl()}/entrar`;
  },

  /** Página de criação de um novo evento. */
  createEvent(): string {
    return `${publicAppBaseUrl()}/criar-evento`;
  },

  /** Página de definições da conta. */
  settings(): string {
    return `${publicAppBaseUrl()}/definicoes`;
  },

  /**
   * Registo com email e código OTP pré-preenchidos.
   *
   * O código só viaja por email (nunca na resposta da API). O frontend
   * lê `email`/`codigo` da query string e abre directamente o passo de
   * validação.
   */
  registerOtp(email: string, code: string): string {
    const params = new URLSearchParams({ email, codigo: code });
    return `${publicAppBaseUrl()}/criar-conta?${params.toString()}`;
  },

  /** Endpoint direto de RSVP da API (útil em clientes sem frontend). */
  rsvp(token: string): string {
    return `${trimBase(env.API_BASE_URL)}/api/v1/public/invitations/${token}/rsvp`;
  },
};
