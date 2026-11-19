import pino from 'pino';

/**
 * Logger da aplicação via Pino.
 *
 * Em desenvolvimento usa pino-pretty; em produção emite JSON numa
 * linha, pronto para ingestão por sistemas de log.
 *
 * `redact` remove segredos e PII de qualquer objeto registado:
 * tokens de gestão/convite, cookies, cabeçalho Authorization e
 * credenciais SMTP. As regras cobrem os nomes usuais (camelCase e
 * snake_case) para que um `logger.info({ token })` acidental não
 * escreva o segredo em disco.
 */
const isDev = process.env.NODE_ENV === 'development';

export const redactPaths = [
  'token',
  'tokenHash',
  'tokenEncrypted',
  'token_encrypted',
  'email',
  'recipientEmail',
  'recipient_email',
  'guestEmail',
  'guest_email',
  'hostEmail',
  'host_email',
  'to',
  'payload.token',
  'payload.tokenEncrypted',
  'manageToken',
  'manage_token',
  'inviteToken',
  'invite_token',
  'invitationUrl',
  'invitation_url',
  'sessionToken',
  'session_token',
  'csrfToken',
  'csrf_token',
  'cookie',
  'cookies',
  // URLs podem transportar o token de convite em claro.
  'url',
  'originalUrl',
  'req.url',
  'req.originalUrl',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'password',
  'SMTP_PASS',
  'BREVO_SMTP_LOGIN',
  'BREVO_SMTP_KEY',
  'BREVO_API_KEY',
  'authorization',
  'set-cookie',
  'setCookie',
  '*.token',
  '*.tokenHash',
  '*.tokenEncrypted',
  '*.token_encrypted',
  '*.email',
  '*.recipientEmail',
  '*.recipient_email',
  '*.guestEmail',
  '*.guest_email',
  '*.hostEmail',
  '*.host_email',
  '*.to',
  '*.inviteToken',
  '*.invite_token',
  '*.invitationUrl',
  '*.invitation_url',
  '*.sessionToken',
  '*.csrfToken',
  '*.url',
  '*.originalUrl',
];

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  redact: { paths: redactPaths, censor: '[redacted]' },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  ...(isDev ? {} : { base: { pid: undefined, hostname: undefined } }),
});
