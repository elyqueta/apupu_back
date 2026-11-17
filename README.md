# Conto Contigo — Backend

API REST do **Conto Contigo**, uma plataforma de convites para eventos.

- **Stack:** Node.js 20 + Express 4 + TypeScript 5 + PostgreSQL 16
- **Porta da API:** `3000`
- **Porta do Postgres:** `5432`
- **Contas de anfitrião:** registo e login com email e senha; o link
  secreto por evento mantém-se válido em paralelo.
- **Aceite público do convite:** não exige conta.

## Âmbito

Incluído:

- Criar conta de anfitrião (email + senha) com verificação prévia do
  email por código OTP, e repor senha.
- Perfil com data de nascimento opcional, telefone, locale e avatar (URL).
- Gerir vários eventos por conta: lista paginada, painel, convidados,
  actividade, relatórios e tarefas.
- Criar e editar eventos por link secreto (fluxo legado, sem conta).
- Escolher um template de convite (infraestrutura; templates finais
  serão fornecidos pelo responsável do produto).
- Registar convidados, indicar mesa e enviar convites por email.
- Página pública do convite com aceitação, alteração de resposta e recusa.
- Recusa cancela os lembretes futuros e notifica o anfitrião por email.
- Lembretes automáticos a 14, 7, 3 e 1 dia antes do evento, às 09:00 no
  fuso do evento.

Fora do âmbito: painel administrativo, pagamentos, SMS e WhatsApp.

## Arranque rápido

Pré-requisito: um PostgreSQL local em `localhost:5432` com a base e o
utilizador indicados em `.env.example` (ou ajustar `DATABASE_URL`).

```bash
cp .env.example .env
npm install
npm run migrate:up
npm run seed
npm run dev
```

Alternativa com Docker: `docker compose up -d postgres` expõe o
Postgres em `localhost:5433` (para não colidir com uma instância local
na porta 5432); nesse caso ajustar `DATABASE_URL` no `.env` para a
porta `5433`.

Smoke test (noutro terminal):

```bash
npm run smoke
# fluxo completo, escreve dados de teste:
SMOKE_WRITE=true npm run smoke
```

Documentação interativa: <http://localhost:3000/api-docs> · spec em
<http://localhost:3000/openapi.json>.

## Docker Compose

```bash
docker compose up -d --build   # primeira vez ou após alterar código/migrations
docker compose up -d           # arranque normal
docker compose down            # parar (os dados persistem no volume)
```

O container da API aplica as migrations pendentes antes de arrancar o
servidor.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Estado da API e da base de dados |
| `GET` | `/api/v1/templates` | Templates de convite ativos |
| `POST` | `/api/v1/events` | Cria evento, convidados e entregas de email (sem conta) |
| `POST` | `/api/v1/auth/register/request-code` | Valida o email e envia um código OTP de 6 dígitos |
| `POST` | `/api/v1/auth/register/verify-code` | Troca o código por um `verification_token` de uso único |
| `POST` | `/api/v1/auth/register` | Cria conta já verificada (exige `verification_token`) |
| `POST` | `/api/v1/auth/email/verify` | Consome o token de verificação (contas antigas) |
| `POST` | `/api/v1/auth/email/verify/resend` | Reenvia verificação (sempre `202`) |
| `POST` | `/api/v1/auth/login` | Cria sessão de conta e devolve `csrf_token` |
| `POST` | `/api/v1/auth/logout` | Revoga a sessão e limpa cookies |
| `GET` | `/api/v1/auth/session` | Conta autenticada, perfil e `csrf_token` |
| `POST` | `/api/v1/auth/password/forgot` | Enfileira reposição de senha (sempre `202`) |
| `POST` | `/api/v1/auth/password/reset` | Define nova senha a partir do token |
| `POST` | `/api/v1/auth/password/change` | Altera a senha autenticada |
| `GET` | `/api/v1/host/profile` | Perfil da conta |
| `PATCH` | `/api/v1/host/profile` | Atualiza o perfil (data de nascimento opcional) |
| `POST` | `/api/v1/host/profile/avatar` | Define o URL do avatar |
| `POST` | `/api/v1/host/profile/avatar/upload` | Envia imagem (multipart) e define-a como avatar via Cloudinary |
| `GET` | `/api/v1/host/events` | Lista paginada dos eventos da conta |
| `POST` | `/api/v1/host/events` | Cria evento na conta (email verificado) |
| `DELETE` | `/api/v1/host/events/:eventId` | Apaga evento da conta |
| `POST` | `/api/v1/host/events/:eventId/manage-link/resend` | Emite e envia um novo link de gestão (rotação) |
| `GET` | `/api/v1/host/dashboard` | Próximo evento, próximos e totais |
| `GET` | `/api/v1/host/guests` | Convidados de todos os eventos (paginado) |
| `GET` | `/api/v1/host/activity` | Actividade da conta (paginada) |
| `GET` | `/api/v1/host/events/:eventId/activity` | Actividade do evento (paginada) |
| `GET` | `/api/v1/host/reports/summary` | Agregados por evento e taxas |
| `GET` | `/api/v1/host/events/:eventId/reports` | Série diária do evento |
| `GET` | `/api/v1/host/tasks` | Tarefas da conta |
| `POST` | `/api/v1/host/tasks` | Cria tarefa |
| `PATCH` | `/api/v1/host/tasks/:taskId` | Atualiza tarefa |
| `DELETE` | `/api/v1/host/tasks/:taskId` | Remove tarefa |
| `POST` | `/api/v1/host/session` | Troca o link secreto por sessão `HttpOnly` |
| `DELETE` | `/api/v1/host/session/:eventId` | Revoga a sessão de gestão |
| `GET` | `/api/v1/host/events/:eventId` | Evento, estatísticas e convidados |
| `PATCH` | `/api/v1/host/events/:eventId` | Actualiza o evento e reconcilia lembretes |
| `GET` | `/api/v1/host/events/:eventId/invitations` | Lista convidados |
| `POST` | `/api/v1/host/events/:eventId/invitations` | Adiciona convidado e enfileira convite |
| `PATCH` | `/api/v1/host/events/:eventId/invitations/:invitationId` | Actualiza convidado |
| `DELETE` | `/api/v1/host/events/:eventId/invitations/:invitationId` | Remove convidado |
| `POST` | `/api/v1/host/events/:eventId/invitations/:invitationId/resend` | Reenvia convite |
| `POST` | `/api/v1/host/events/:eventId/invitations/:invitationId/revoke` | Revoga acesso do navegador |
| `POST` | `/api/v1/public/invitations/:token/claim` | Reclama o convite no primeiro navegador |
| `GET` | `/api/v1/public/invitations/:token` | Consulta o convite com a capacidade do navegador |
| `PUT` | `/api/v1/public/invitations/:token/rsvp` | Aceita, altera ou recusa o convite |

O contrato detalhado está em [docs/API-CONTRACT.md](docs/API-CONTRACT.md).
A especificação autoritária do produto está em [`backend/`](backend/).

## Segurança e privacidade

- **Senhas** são guardadas com Argon2id (`ARGON2_*`). A senha em claro
  nunca é persistida, registada ou devolvida. O login falhado usa uma
  verificação contra um hash descartável para reduzir enumeração por
  temporização e bloqueia temporariamente após `AUTH_MAX_FAILED_LOGINS`.
- A **sessão de conta** (`apupu_auth`) é um cookie `HttpOnly`; operações
  mutáveis exigem `X-CSRF-Token` derivado da sessão. O login devolve o
  token CSRF e `GET /auth/session` volta a devolvê-lo.
- O **registo exige verificação do email por OTP** antes de criar a
  conta: código numérico de 6 dígitos (`REGISTRATION_OTP_TTL_MINUTES`),
  guardado apenas como HMAC ligado ao email, com
  `REGISTRATION_OTP_MAX_ATTEMPTS` tentativas e
  `REGISTRATION_OTP_RESEND_SECONDS` entre pedidos. O sucesso devolve um
  `verification_token` opaco de uso único, válido por
  `REGISTRATION_VERIFICATION_TTL_MINUTES`. A conta é criada já com
  `email_verified=true`.
- Os **tokens de verificação de email e de reposição de senha** são de
  uso único e guardados apenas como HMAC; o token em claro só existe no
  link entregue.
- O **link de gestão** é um token de 256 bits, válido por 30 dias
  (`MANAGE_TOKEN_TTL_DAYS`). A base de dados guarda apenas o HMAC. O
  token em claro é enviado uma única vez para o email do anfitrião;
  nunca é devolvido em JSON nem escrito em logs. Ao ser usado em
  `POST /host/session`, o link roda: o anterior é revogado e um novo é
  enviado por email. O mesmo acontece em
  `POST /host/events/:eventId/manage-link/resend`.
- **Rate limiting** cobre autenticação, escritas de gestão
  (`WRITE_RATE_LIMIT_*`) e RSVP público por IP + token
  (`RSVP_RATE_LIMIT_*`). O excesso devolve `429 rate_limited`.
- **Auditoria** de eventos críticos em `host_audit_log`, com actor,
  evento, IP, `request_id` e resultado; nunca guarda senhas, tokens ou
  `birth_date`.
- O segredo de gestão é trocado por uma sessão `HttpOnly` curta, por
  evento (`apupu_host_<eventId>`). Operações mutáveis exigem
  `X-CSRF-Token` derivado da sessão.
- O **token de convite** é guardado em hash (lookup) e cifrado com
  AES-256-GCM (para reenvios e lembretes).
- O primeiro navegador que abre um convite fica **vinculado** a ele por
  um cookie `HttpOnly` (`apupu_guest`). Outro navegador recebe o mesmo
  `404` genérico de um link inexistente. Isto não identifica uma pessoa
  nem um dispositivo físico.
- Todas as leituras e mutações de eventos são limitadas por
  `events.host_id`; uma conta sem posse recebe `404`, não `403`.
- Respostas da API têm `Cache-Control: private, no-store`.
- Tokens e dados pessoais nunca são escritos em logs.

## Lembretes e outbox

A cadência é configurada em `REMINDER_OFFSETS_DAYS` (por omissão
`14,7,3,1`) e a hora local em `REMINDER_LOCAL_HOUR` (por omissão `9`). O
worker da outbox corre a cada `OUTBOX_SCAN_INTERVAL_MS` quando
`OUTBOX_ENABLED=true`; também é possível executar um ciclo manual:

```bash
npm run outbox:run
```

Uma recusa cancela imediatamente os lembretes pendentes desse convidado.
Cancelar o evento cancela convites/lembretes pendentes e enfileira o
aviso de cancelamento aos convidados que não recusaram.

## Retenção de contas

Contas sem login durante `ACCOUNT_RETENTION_MONTHS` meses (por omissão
24) são eliminadas pelo job operacional:

```bash
npm run retention:run
```

- O corte usa `COALESCE(last_login_at, created_at)`, por isso contas
  criadas e nunca usadas também são abrangidas.
- Perfil, sessões, tokens, tarefas e entregas de email são apagados em
  cascata. Os eventos não são apagados: ficam com `host_id = NULL`,
  como os eventos legados.
- Os OTP de registo associados ao email são removidos.
- Processa em lotes (`RETENTION_BATCH_SIZE`, por omissão 500) com
  `FOR UPDATE SKIP LOCKED`, para locks curtos e execuções paralelas
  seguras.
- É idempotente e regista apenas contagens — nunca emails, nomes ou
  outros dados pessoais.

Recomendado em cron diário, por exemplo `0 3 * * *`.

## Email

- `EMAIL_TRANSPORT=json` (desenvolvimento): não envia; escreve as
  mensagens renderizadas em `EMAIL_JSON_DIR` (por omissão
  `tmp/outbox/`). O conteúdo inclui links com tokens, por isso nunca é
  escrito nos logs.
- `EMAIL_TRANSPORT=smtp`: usa `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS` e `EMAIL_FROM`. Se `SMTP_PASS` estiver vazio
  mas existir `RESEND_API_KEY`, usa o SMTP do Resend
  (`smtp.resend.com`, utilizador `resend`, porta `465`, SSL) — a mesma
  chave serve os dois modos.
- `EMAIL_TRANSPORT=resend`: envia pela API HTTP do Resend
  (`https://api.resend.com/emails`) com `RESEND_API_KEY` e
  `EMAIL_FROM`.

`onboarding@resend.dev` é o remetente de teste do Resend e só entrega
ao email dono da conta. Para enviar a outros destinatários é preciso
verificar um domínio no Resend e trocar `EMAIL_FROM`.

A outbox tem retries com backoff exponencial (`EMAIL_MAX_ATTEMPTS`,
`EMAIL_RETRY_BASE_MS`) e chaves idempotentes que impedem envios
duplicados.

## Avatares (Cloudinary)

- `POST /api/v1/host/profile/avatar/upload` recebe
  `multipart/form-data` no campo `avatar` (JPEG, PNG ou WebP, até
  `AVATAR_MAX_BYTES`, por omissão 5 MiB).
- O backend assina o upload para o Cloudinary com
  `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e
  `CLOUDINARY_API_SECRET`; o segredo nunca é enviado ao frontend.
- O URL seguro devolvido pelo Cloudinary fica guardado no perfil.
- Sem as três variáveis, o endpoint responde
  `503 avatar_upload_unavailable`. O avatar por URL
  (`POST /api/v1/host/profile/avatar`) continua disponível.

## Testes e validação

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
```

Os testes unitários não precisam de base de dados. O smoke test precisa
da API a correr.

## Estrutura

```
src/
├── config/         env (Zod), logger (Pino), CORS, Swagger
├── controllers/    camada HTTP (sem regras de negócio)
├── database/       pool Postgres e helpers de transacção
├── dto/            conversão explícita para o contrato (snake_case)
├── errors/         AppError + erros HTTP tipados
├── middlewares/    asyncHandler, validate, errorHandler, hostAuth, hostAccountAuth, guestAuth, CSRF
├── repositories/   SQL e mapeamento de linhas
├── routes/v1/      routers por domínio + agregador
├── schemas/        validação Zod
├── scripts/        seeds, smoke test, ciclo manual da outbox
├── services/       contas, eventos, convites, sessão, email, lembretes, outbox
├── types/          tipos do domínio
└── utils/          tokens, senhas, cifra, datas, links, cookies, paginação
migrations/         node-pg-migrate
tests/              Vitest
backend/            especificação autoritária do produto
docs/               contrato e modelo de dados da implementação
```

## Decisões de produto

As decisões que estavam pendentes foram fechadas e estão registadas em
[`docs/DECISOES-PRODUTO.md`](docs/DECISOES-PRODUTO.md), com o estado de
implementação de cada uma. A única dependência externa em aberto é o
fornecimento dos templates finais e respectivos limites de
acessibilidade.
