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

  CSRF_COOKIE_NAME: z.string().min(1).default('apupu_csrf'),
  CSRF_HEADER_NAME: z.string().min(1).default('x-csrf-token'),

  GUEST_COOKIE_NAME: z.string().min(1).default('apupu_guest'),
  GUEST_COOKIE_TTL_DAYS: z.coerce.number().int().positive().default(180),

  EMAIL_TRANSPORT: z.enum(['json', 'smtp']).default('json'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number({ error: 'SMTP_PORT deve ser um número' }).int().positive().default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(1).default('Apupu <convites@apupu.local>'),

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
  OUTBOX_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(60000),

  MAX_INVITATIONS_PER_EVENT: z.coerce.number().int().positive().default(1000),
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
