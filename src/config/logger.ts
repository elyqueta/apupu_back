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

const redactPaths = [
  'token',
  'tokenHash',
  'manageToken',
  'manage_token',
  'inviteToken',
  'invite_token',
  'sessionToken',
  'session_token',
  'csrfToken',
  'csrf_token',
  'cookie',
  'cookies',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'password',
  'SMTP_PASS',
  'authorization',
  'set-cookie',
  'setCookie',
  '*.token',
  '*.tokenHash',
  '*.inviteToken',
  '*.invite_token',
  '*.sessionToken',
  '*.csrfToken',
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
