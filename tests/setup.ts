/**
 * Ambiente mínimo para os testes unitários.
 *
 * `config/env.ts` valida e encerra o processo se faltar uma variável,
 * por isso os testes definem tudo o que é obrigatório antes de
 * importarem qualquer módulo da aplicação.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://apupu:apupu@localhost:5433/apupu_test';
process.env.CORS_ORIGIN = 'http://localhost:4200';
process.env.APP_BASE_URL = 'http://localhost:4200';
process.env.API_BASE_URL = 'http://localhost:3000';
process.env.TOKEN_PEPPER = 'test_token_pepper_com_pelo_menos_32_caracteres';
process.env.EMAIL_TRANSPORT = 'json';
process.env.EMAIL_JSON_DIR = 'tmp/test-outbox';
process.env.SUPPORT_EMAIL = 'apoio@exemplo.pt';
process.env.OUTBOX_ENABLED = 'false';
process.env.REMINDER_OFFSETS_DAYS = '14,7,3,1';
process.env.REMINDER_LOCAL_HOUR = '9';
