import 'dotenv/config';
import { z } from 'zod';
import { logger } from './logger';

/**
 * Validação das variáveis de ambiente na inicialização.
 *
 * O princípio é "fail fast": se falta uma variável obrigatória ou está
 * num formato inválido, a aplicação recusa subir e indica exatamente
 * qual o problema — em vez de falhar mais tarde, na primeira
 * requisição que dependa dela.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  PORT: z.coerce.number({ error: 'PORT deve ser um número' }).int().positive().default(3000),

  // 0 = sem proxy à frente; 1 = um proxy (cloud, reverse proxy).
  TRUST_PROXY: z.coerce.number({ error: 'TRUST_PROXY deve ser um número' }).int().min(0).default(0),

  DATABASE_URL: z
    .string({ error: 'DATABASE_URL é obrigatória' })
    .min(1, 'DATABASE_URL não pode ser vazia')
    .url('DATABASE_URL deve ser uma URL de conexão válida'),

  CORS_ORIGIN: z.string({ error: 'CORS_ORIGIN é obrigatória' }).min(1, 'CORS_ORIGIN não pode ser vazia'),

  CORS_ALLOW_LOCALHOST: z.stringbool().default(false),

  RATE_LIMIT_WINDOW_MS: z.coerce
    .number({ error: 'RATE_LIMIT_WINDOW_MS deve ser um número' })
    .int()
    .positive()
    .default(900000),

  RATE_LIMIT_MAX: z.coerce
    .number({ error: 'RATE_LIMIT_MAX deve ser um número' })
    .int()
    .positive()
    .default(300),

  PUBLIC_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  HOST_SESSION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  HOST_SESSION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  /** Limite para escritas autenticadas (eventos, convidados, reenvios). */
  WRITE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  WRITE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  /** Limite específico do RSVP público. */
  RSVP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RSVP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  /** Base pública do frontend Angular. */
  APP_BASE_URL: z
    .string({ error: 'APP_BASE_URL é obrigatória' })
    .url('APP_BASE_URL deve ser uma URL válida'),

  /** Base pública da própria API (usada em links diretos e no smoke test). */
  API_BASE_URL: z
    .string({ error: 'API_BASE_URL é obrigatória' })
    .url('API_BASE_URL deve ser uma URL válida'),

  /**
   * Pepper HMAC aplicado aos tokens antes de os guardar.
   *
   * Os tokens de gestão e de convite dão acesso direto a dados
   * pessoais, por isso nunca são guardados em claro. Um pepper (e não
   * apenas SHA-256 puro) garante que, mesmo com acesso à base de
   * dados, não é possível reconstruir os tokens por dicionário.
   */
  TOKEN_PEPPER: z
    .string({ error: 'TOKEN_PEPPER é obrigatória' })
    .min(32, 'TOKEN_PEPPER deve ter no mínimo 32 caracteres.'),

  HOST_COOKIE_NAME: z.string().min(1).default('apupu_host'),
  HOST_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  /** Validade máxima do link de gestão (30 dias por decisão de produto). */
  MANAGE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CSRF_COOKIE_NAME: z.string().min(1).default('apupu_csrf'),
  CSRF_HEADER_NAME: z.string().min(1).default('x-csrf-token'),

  GUEST_COOKIE_NAME: z.string().min(1).default('apupu_guest'),
  GUEST_COOKIE_TTL_DAYS: z.coerce.number().int().positive().default(180),

  /** Sessão de conta do anfitrião (cookie `apupu_auth`). */
  AUTH_COOKIE_NAME: z.string().min(1).default('apupu_auth'),
  AUTH_CSRF_COOKIE_NAME: z.string().min(1).default('apupu_csrf_auth'),
  AUTH_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(10080),

  /**
   * Retenção de contas inactivas.
   *
   * Uma conta sem login durante este número de meses é eliminada pelo
   * job operacional (`npm run retention:run`). O corte usa
   * `COALESCE(last_login_at, created_at)`, para que contas criadas e
   * nunca usadas também sejam abrangidas. Os lotes mantêm as
   * transacções curtas e os locks previsíveis.
   */
  ACCOUNT_RETENTION_MONTHS: z.coerce.number().int().positive().default(24),
  RETENTION_BATCH_SIZE: z.coerce.number().int().positive().max(10000).default(500),

  /** Limites dedicados de registo/login/reposição de senha. */
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  AUTH_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  /**
   * Verificação de email por OTP no registo.
   *
   * O código é de 6 dígitos, tem poucos minutos de vida e um número
   * limitado de tentativas. O token devolvido após a verificação é de
   * uso único e antecede a criação da conta.
   */
  REGISTRATION_OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  REGISTRATION_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  REGISTRATION_OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(60),
  REGISTRATION_VERIFICATION_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  /** Idade mínima (anos) para uma data de nascimento ser aceite. */
  MIN_HOST_AGE_YEARS: z.coerce.number().int().min(0).default(5),

  /**
   * Cloudinary — armazenamento dos avatares e das imagens de capa.
   *
   * O upload é assinado no servidor; o API secret nunca é enviado ao
   * frontend. Sem as três variáveis, os endpoints de upload respondem
   * `503 avatar_upload_unavailable` / `profile_cover_upload_unavailable`
   * / `event_cover_upload_unavailable`, mas o resto da API continua a
   * funcionar e as imagens por URL mantêm-se disponíveis.
   */
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  CLOUDINARY_AVATAR_FOLDER: z.string().trim().min(1).default('conta-comigo/avatars'),
  CLOUDINARY_EVENT_FOLDER: z.string().trim().min(1).default('conta-comigo/events'),
  CLOUDINARY_PROFILE_COVER_FOLDER: z
    .string()
    .trim()
    .min(1)
    .default('conta-comigo/profile-covers'),
  /** Tamanho máximo do ficheiro de avatar (5 MiB por omissão). */
  AVATAR_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  /** Tamanho máximo da imagem de capa do evento (8 MiB por omissão). */
  EVENT_COVER_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  /** Tamanho máximo da imagem de capa do perfil (8 MiB por omissão). */
  PROFILE_COVER_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),

  /** Parâmetros do Argon2id. Ajustáveis por ambiente, nunca por pedido. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8 * 1024).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(255).default(1),

  EMAIL_TRANSPORT: z.enum(['json', 'smtp', 'resend', 'brevo']).default('json'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number({ error: 'SMTP_PORT deve ser um número' }).int().positive().default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(1).default('Conto Contigo <convites@apupu.local>'),
  BREVO_SMTP_HOST: z.string().trim().min(1).default('smtp-relay.brevo.com'),
  BREVO_SMTP_PORT: z.coerce.number().int().positive().default(587),
  BREVO_SMTP_LOGIN: z.string().trim().optional(),
  BREVO_SMTP_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().trim().optional(),
  BREVO_FROM_NAME: z.string().trim().min(1).default('Conto Contigo'),
  BREVO_FROM_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().email().optional()
  ),

  /**
   * Chave da API do Resend.
   *
   * Pode ser usada de duas formas:
   * - `EMAIL_TRANSPORT=resend`: envio pela API HTTP do Resend.
   * - `EMAIL_TRANSPORT=smtp` sem `SMTP_PASS`: fallback para o SMTP do
   *   Resend (`smtp.resend.com`, utilizador `resend`, porta 465/SSL).
   *
   * O `.env.render` já traz esta chave; em produção basta defini-la no
   * painel do Render, sem duplicar o segredo em `SMTP_PASS`.
   */
  RESEND_API_KEY: z.string().trim().optional(),

  /**
   * Em desenvolvimento (`EMAIL_TRANSPORT=json`) as mensagens são
   * escritas neste diretório em vez de enviadas. Não são escritas nos
   * logs para não expor tokens de convite/gestão.
   */
  EMAIL_JSON_DIR: z.string().min(1).default('tmp/outbox'),

  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_RETRY_BASE_MS: z.coerce.number().int().positive().default(60000),

  /**
   * Cadência de lembretes em dias antes do evento. A regra aprovada é
   * 14, 7, 3 e 1 — configurável para testes, mas não deve ser alterada
   * sem decisão do produto.
   */
  REMINDER_OFFSETS_DAYS: z
    .string()
    .default('14,7,3,1')
    .transform((value) =>
      value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
    .refine((offsets) => offsets.length > 0, {
      message: 'REMINDER_OFFSETS_DAYS deve conter pelo menos um número inteiro positivo.',
    }),

  /** Hora local do evento a que os lembretes são enviados (0–23). */
  REMINDER_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(9),

  /** Liga o worker que envia convites, lembretes e avisos da outbox. */
  OUTBOX_ENABLED: z.stringbool().default(true),
  /**
   * Corre o agendador da outbox dentro do processo da API.
   *
   * Conveniente em desenvolvimento e em protótipos com um único
   * serviço. Em produção, define `false` e corre `npm run worker`
   * (ou `npm run worker:start`) num processo separado: a API fica
   * dedicada a responder a pedidos e o envio de emails não compete
   * com ela.
   */
  OUTBOX_IN_API: z.stringbool().default(true),
  OUTBOX_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(60000),

  MAX_INVITATIONS_PER_EVENT: z.coerce.number().int().positive().default(1000),
}).superRefine((values, context) => {
  if (values.EMAIL_TRANSPORT !== 'brevo') return;

  const requiredBrevoFields = [
    ['BREVO_SMTP_LOGIN', values.BREVO_SMTP_LOGIN],
    ['BREVO_SMTP_KEY', values.BREVO_SMTP_KEY],
    ['BREVO_FROM_EMAIL', values.BREVO_FROM_EMAIL],
  ] as const;

  for (const [field, value] of requiredBrevoFields) {
    if (!value) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} é obrigatória quando EMAIL_TRANSPORT=brevo.`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    logger.error({ issues: result.error.issues }, 'Erro na configuração de variáveis de ambiente');

    for (const issue of result.error.issues) {
      const campo = issue.path.join('.') || '(desconhecido)';
      logger.warn(`  • ${campo}: ${issue.message}`);
    }

    logger.error('Verifique o ficheiro .env (use .env.example como referência) e tente novamente.');
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
