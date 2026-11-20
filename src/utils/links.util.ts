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
 * `APP_BASE_URL` é a fonte de verdade. Quando ela aponta para localhost
 * (por exemplo, ao copiar o `.env` de desenvolvimento para o Render),
 * usamos a primeira origem pública de `CORS_ORIGIN`. Assim os links
 * continuam corretos em ambientes de teste com `NODE_ENV=development`,
 * onde a guarda de produção não está ativa e a docs precisa de ficar
 * acessível. Em produção o arranque falha se `APP_BASE_URL` for local,
 * pelo que este fallback nunca altera um deploy corretamente
 * configurado.
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

  /** Página de aceitação de um convite de equipa. */
  teamInvite(token: string): string {
    return `${publicAppBaseUrl()}/equipas/convite/${token}`;
  },

  /**
   * Página pública de confirmação de "Não conheço este convite".
   *
   * A abertura da página não revoga nada: só o `POST` explícito do
   * botão de confirmação chama a API. Scanners de email que seguem
   * ligações ficam assim sem efeito.
   */
  teamInviteReport(token: string): string {
    return `${publicAppBaseUrl()}/equipas/convite/${token}/denunciar`;
  },

  /** Página de uma equipa dentro do evento. */
  team(eventId: string, teamId: string): string {
    const params = new URLSearchParams({ equipa: teamId });
    return `${publicAppBaseUrl()}/eventos/${eventId}/equipas?${params.toString()}`;
  },

  /** Página da tarefa dentro do evento. */
  task(eventId: string, taskId: string): string {
    const params = new URLSearchParams({ tarefa: taskId });
    return `${publicAppBaseUrl()}/eventos/${eventId}/tarefas?${params.toString()}`;
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
