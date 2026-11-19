import { env } from '../config/env';

/** Remove barras finais para evitar `//` nos links construídos. */
function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Base pública do frontend usada nos links enviados por email.
 *
 * `APP_BASE_URL` é a única fonte de verdade. Não há fallback para
 * `CORS_ORIGIN`: em produção o arranque falha se a variável estiver
 * ausente ou apontar para localhost, pelo que os links nunca são
 * construídos a partir de uma origem diferente da configurada.
 */
export function publicAppBaseUrl(): string {
  return trimBase(env.APP_BASE_URL);
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
