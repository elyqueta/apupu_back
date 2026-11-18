/**
 * Respostas de erro reutilizáveis e mapa por operação.
 *
 * As anotações JSDoc das rotas descrevem o caso feliz. Este módulo
 * completa o spec com o corpo JSON de cada erro real, evitando repetir
 * o mesmo schema em todas as rotas. O `swagger.ts` aplica o mapa depois
 * de gerar o spec.
 */

const REQUEST_ID = '6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e';

/** Resposta OpenAPI com corpo JSON no envelope de erro. */
interface ErrorResponseObject {
  description: string;
  content: {
    'application/json': {
      schema: { $ref: string };
      example: { error: Record<string, unknown> };
    };
  };
}

function errorResponse(
  description: string,
  code: string,
  message: string
): ErrorResponseObject {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: {
          error: {
            code,
            message,
            request_id: REQUEST_ID,
          },
        },
      },
    },
  };
}

function validationResponse(
  description: string,
  code: string,
  message: string
): ErrorResponseObject {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: {
          error: {
            code,
            message,
            fields: {
              email: ['Email inválido.'],
            },
            request_id: REQUEST_ID,
          },
        },
      },
    },
  };
}

export const errorResponses = {
  InvalidJson: errorResponse(
    'Corpo da requisição não é um JSON válido.',
    'invalid_json',
    'Corpo da requisição não é um JSON válido.'
  ),
  BadRequest: errorResponse(
    'A requisição está malformada ou não faz sentido como veio.',
    'bad_request',
    'Requisição inválida.'
  ),
  HostSessionInvalid: errorResponse(
    'Sessão de gestão ou de conta ausente, expirada ou de outro evento.',
    'host_session_invalid',
    'Sessão inválida ou expirada.'
  ),
  InvalidCredentials: errorResponse(
    'Email ou senha inválidos.',
    'invalid_credentials',
    'Email ou senha inválidos.'
  ),
  CsrfInvalid: errorResponse(
    'Falta ou não coincide o token CSRF.',
    'csrf_invalid',
    'Token CSRF inválido ou ausente.'
  ),
  EmailNotVerified: errorResponse(
    'A conta ainda não confirmou o email; a escrita de eventos está bloqueada.',
    'email_not_verified',
    'Confirma o teu email antes de gerir eventos.'
  ),
  GuestEmailNotVerified: errorResponse(
    'A conta ainda não confirmou o email; "Meus convites" fica indisponível.',
    'email_not_verified',
    'Confirme o seu email para ver os seus convites.'
  ),
  InvitationNotFound: errorResponse(
    'Token inválido, convite revogado ou reclamado por outro navegador.',
    'invitation_not_found',
    'Convite não encontrado.'
  ),
  EventNotFound: errorResponse(
    'Evento inexistente ou não pertencente à conta.',
    'event_not_found',
    'Evento não encontrado.'
  ),
  HostActionForbidden: errorResponse(
    'A ação está reservada ao anfitrião (proprietário) do evento.',
    'host_action_forbidden',
    'Apenas o anfitrião pode executar esta ação.'
  ),
  ManagerNotFound: errorResponse(
    'Gestor inexistente, removido ou de outro evento.',
    'manager_not_found',
    'Gestor não encontrado.'
  ),
  ManagerAlreadyExists: errorResponse(
    'O email já é gestor activo deste evento.',
    'manager_already_exists',
    'Este email já é gestor do evento.'
  ),
  ManageLinkInvalid: errorResponse(
    'Link de gestão inválido, expirado ou já rodado.',
    'manage_link_invalid',
    'Link de gestão inválido ou expirado.'
  ),
  TaskNotFound: errorResponse(
    'Tarefa inexistente ou não pertencente à conta.',
    'task_not_found',
    'Tarefa não encontrada.'
  ),
  ConflictGeneric: errorResponse(
    'Conflito com o estado atual do recurso.',
    'event_not_scheduled',
    'O evento ainda não está agendado.'
  ),
  EmailDuplicate: errorResponse(
    'O email já está na lista de convidados, o convite já foi aberto (`invitation_already_opened`) ou pertence ao anfitrião (`invitation_host_email`).',
    'invitation_email_duplicate',
    'Este email já está na lista de convidados.'
  ),
  InvitationHostEmail: errorResponse(
    'Conflito: evento não agendado, limite de convidados atingido ou email do anfitrião.',
    'invitation_host_email',
    'O email do anfitrião não pode ser adicionado como convidado.'
  ),
  InvitationNotResendable: errorResponse(
    'O convite está revogado ou não tem um link reutilizável.',
    'invitation_not_resendable',
    'Este convite não pode ser reenviado.'
  ),
  EmailAlreadyRegistered: errorResponse(
    'O email já tem uma conta.',
    'email_already_registered',
    'Este email já está registado.'
  ),
  ValidationFailed: validationResponse(
    'Dados inválidos; `fields` lista os campos e mensagens.',
    'validation_failed',
    'Verifique os campos indicados.'
  ),
  VerificationInvalid: errorResponse(
    'Token de verificação de email inválido ou expirado.',
    'verification_invalid',
    'Link de verificação inválido ou expirado.'
  ),
  VerificationRequired: validationResponse(
    'É necessário verificar o email antes de criar a conta.',
    'verification_required',
    'Verifica o teu email antes de criar a conta.'
  ),
  OtpInvalid: validationResponse(
    'Código OTP inválido ou expirado.',
    'otp_invalid',
    'Código inválido ou expirado.'
  ),
  OtpAttemptsExceeded: validationResponse(
    'O limite de tentativas do código foi atingido; é necessário pedir outro.',
    'otp_attempts_exceeded',
    'Demasiadas tentativas. Pede um novo código.'
  ),
  ResetInvalid: errorResponse(
    'Token de reposição de senha inválido ou expirado.',
    'reset_invalid',
    'Link de reposição inválido ou expirado.'
  ),
  AccountLocked: errorResponse(
    'Conta temporariamente bloqueada após demasiadas falhas de login.',
    'account_locked',
    'Conta temporariamente bloqueada. Tente novamente mais tarde.'
  ),
  RateLimited: errorResponse(
    'Limite de pedidos excedido.',
    'rate_limited',
    'Demasiados pedidos. Tente novamente mais tarde.'
  ),
  OtpResendTooSoon: errorResponse(
    'Foi pedido um código há menos tempo do que o intervalo mínimo.',
    'otp_resend_too_soon',
    'Aguarda antes de pedir um novo código.'
  ),
  InternalError: errorResponse(
    'Erro inesperado; sem stack trace nem detalhes internos.',
    'internal_error',
    'Erro interno do servidor.'
  ),
  ServiceUnavailable: errorResponse(
    'Serviço externo necessário temporariamente indisponível.',
    'service_unavailable',
    'Serviço temporariamente indisponível.'
  ),
  AvatarUploadUnavailable: errorResponse(
    'Upload de avatar indisponível: credenciais Cloudinary ausentes ou provider inacessível.',
    'avatar_upload_unavailable',
    'O upload de avatar está temporariamente indisponível.'
  ),
  EventCoverUploadUnavailable: errorResponse(
    'Upload da imagem de capa indisponível: credenciais Cloudinary ausentes ou provider inacessível.',
    'event_cover_upload_unavailable',
    'O upload da imagem de capa está temporariamente indisponível.'
  ),
  ProfileCoverUploadUnavailable: errorResponse(
    'Upload da capa do perfil indisponível: credenciais Cloudinary ausentes ou provider inacessível.',
    'profile_cover_upload_unavailable',
    'O upload da capa do perfil está temporariamente indisponível.'
  ),
  NotificationNotFound: errorResponse(
    'Notificação inexistente ou já removida.',
    'notification_not_found',
    'Notificação não encontrada.'
  ),
  ActivityNotFound: errorResponse(
    'Actividade inexistente neste evento.',
    'activity_not_found',
    'Actividade não encontrada.'
  ),
} as const;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Mapa `MÉTODO /caminho` → `status` → nome da resposta reutilizável. */
export const operationErrorResponses: Record<
  string,
  Partial<Record<number, keyof typeof errorResponses>>
> = {
  'post /api/v1/auth/register/request-code': {
    409: 'EmailAlreadyRegistered',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/auth/register/verify-code': {
    422: 'OtpInvalid',
    429: 'RateLimited',
  },
  'post /api/v1/auth/register': {
    409: 'EmailAlreadyRegistered',
    422: 'VerificationRequired',
    429: 'RateLimited',
  },
  'post /api/v1/auth/email/verify': {
    422: 'VerificationInvalid',
    429: 'RateLimited',
  },
  'post /api/v1/auth/email/verify/resend': {
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/auth/login': {
    401: 'InvalidCredentials',
    422: 'ValidationFailed',
    423: 'AccountLocked',
    429: 'RateLimited',
  },
  'post /api/v1/auth/logout': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
  },
  'get /api/v1/auth/session': {
    401: 'HostSessionInvalid',
  },
  'post /api/v1/auth/password/forgot': {
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/auth/password/reset': {
    422: 'ResetInvalid',
    429: 'RateLimited',
  },
  'post /api/v1/auth/password/change': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
  },
  'post /api/v1/events': {
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/session': {
    404: 'ManageLinkInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/session/{eventId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    429: 'RateLimited',
  },
  'get /api/v1/host/events/{eventId}': {
    401: 'HostSessionInvalid',
    404: 'EventNotFound',
  },
  'patch /api/v1/host/events/{eventId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'EventNotFound',
    409: 'ConflictGeneric',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/events/{eventId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'EventNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/host/events/{eventId}/invitations': {
    401: 'HostSessionInvalid',
    404: 'EventNotFound',
  },
  'post /api/v1/host/events/{eventId}/invitations': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'EventNotFound',
    409: 'InvitationHostEmail',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'patch /api/v1/host/events/{eventId}/invitations/{invitationId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'InvitationNotFound',
    409: 'EmailDuplicate',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/events/{eventId}/invitations/{invitationId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'InvitationNotFound',
    429: 'RateLimited',
  },
  'post /api/v1/host/events/{eventId}/invitations/{invitationId}/resend': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'InvitationNotFound',
    409: 'InvitationNotResendable',
    429: 'RateLimited',
  },
  'post /api/v1/host/events/{eventId}/invitations/{invitationId}/revoke': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'InvitationNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/host/profile': {
    401: 'HostSessionInvalid',
  },
  'patch /api/v1/host/profile': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/profile/avatar': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/profile/avatar/upload': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
    503: 'AvatarUploadUnavailable',
  },
  'post /api/v1/host/profile/cover': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/profile/cover/upload': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
    503: 'ProfileCoverUploadUnavailable',
  },
  'delete /api/v1/host/profile/cover': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    429: 'RateLimited',
  },
  'get /api/v1/host/events': {
    401: 'HostSessionInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/events': {
    401: 'HostSessionInvalid',
    403: 'EmailNotVerified',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/events/{eventId}/manage-link/resend': {
    401: 'HostSessionInvalid',
    403: 'EmailNotVerified',
    404: 'EventNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/host/events/{eventId}/managers': {
    401: 'HostSessionInvalid',
    404: 'EventNotFound',
  },
  'get /api/v1/host/managers': {
    401: 'HostSessionInvalid',
  },
  'post /api/v1/host/events/{eventId}/managers': {
    401: 'HostSessionInvalid',
    403: 'EmailNotVerified',
    404: 'EventNotFound',
    409: 'ManagerAlreadyExists',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/events/{eventId}/managers/{managerId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'ManagerNotFound',
    429: 'RateLimited',
  },
  'post /api/v1/host/events/{eventId}/managers/{managerId}/resend': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'ManagerNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/host/dashboard': {
    401: 'HostSessionInvalid',
  },
  'get /api/v1/host/guests': {
    401: 'HostSessionInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'get /api/v1/host/invitations': {
    401: 'HostSessionInvalid',
    403: 'GuestEmailNotVerified',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'get /api/v1/host/activity': {
    401: 'HostSessionInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'get /api/v1/host/events/{eventId}/activity': {
    401: 'HostSessionInvalid',
    404: 'EventNotFound',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/events/{eventId}/activity/{activityId}': {
    401: 'HostSessionInvalid',
    403: 'HostActionForbidden',
    404: 'ActivityNotFound',
    429: 'RateLimited',
  },
  'put /api/v1/host/events/{eventId}/cover': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'EventNotFound',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/events/{eventId}/cover/upload': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'EventNotFound',
    422: 'ValidationFailed',
    429: 'RateLimited',
    503: 'EventCoverUploadUnavailable',
  },
  'delete /api/v1/host/events/{eventId}/cover': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'EventNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/host/notifications': {
    401: 'HostSessionInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/notifications': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    429: 'RateLimited',
  },
  'get /api/v1/host/notifications/unread-count': {
    401: 'HostSessionInvalid',
  },
  'post /api/v1/host/notifications/read-all': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    429: 'RateLimited',
  },
  'patch /api/v1/host/notifications/{notificationId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'NotificationNotFound',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/notifications/{notificationId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'NotificationNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/host/reports/summary': {
    401: 'HostSessionInvalid',
  },
  'get /api/v1/host/reports/export': {
    401: 'HostSessionInvalid',
    422: 'ValidationFailed',
  },
  'get /api/v1/host/events/{eventId}/exports/{document}': {
    400: 'BadRequest',
    401: 'HostSessionInvalid',
    404: 'EventNotFound',
    422: 'ValidationFailed',
  },
  'get /api/v1/host/events/{eventId}/reports': {
    401: 'HostSessionInvalid',
    404: 'EventNotFound',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'get /api/v1/host/tasks': {
    401: 'HostSessionInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'post /api/v1/host/tasks': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'patch /api/v1/host/tasks/{taskId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'TaskNotFound',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'delete /api/v1/host/tasks/{taskId}': {
    401: 'HostSessionInvalid',
    403: 'CsrfInvalid',
    404: 'TaskNotFound',
    429: 'RateLimited',
  },
  'post /api/v1/public/invitations/{token}/claim': {
    404: 'InvitationNotFound',
    429: 'RateLimited',
  },
  'get /api/v1/public/invitations/{token}': {
    404: 'InvitationNotFound',
    429: 'RateLimited',
  },
  'put /api/v1/public/invitations/{token}/rsvp': {
    403: 'CsrfInvalid',
    404: 'InvitationNotFound',
    409: 'ConflictGeneric',
    422: 'ValidationFailed',
    429: 'RateLimited',
  },
  'get /api/v1/templates': {
    429: 'RateLimited',
  },
};

export type { Method };
