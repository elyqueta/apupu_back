# Apupu — Backend

API REST da **Apupu**, uma plataforma de convites para eventos.

- **Stack:** Node.js 20 + Express 4 + TypeScript 5 + PostgreSQL 16
- **Porta da API:** `3000`
- **Porta do Postgres:** `5433` (host) → `5432` (container)
- **Sem contas na fase 1:** a gestão do evento é feita por um link secreto
  e cada convidado recebe um link individual.

## Âmbito da primeira fase

Incluído:

- Criar e editar eventos sem registo de utilizador.
- Escolher um template de convite (infraestrutura; templates finais
  serão fornecidos pelo responsável do produto).
- Registar convidados e enviar convites por email.
- Página pública do convite com aceitação, alteração de resposta e recusa.
- Recusa cancela os lembretes futuros e notifica o anfitrião por email.
- Lembretes automáticos a 14, 7, 3 e 1 dia antes do evento, às 09:00 no
  fuso do evento.

Fora do âmbito: contas, login, painel administrativo, pagamentos, SMS e
WhatsApp.

## Arranque rápido

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run migrate:up
npm run seed
npm run dev
```

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
| `POST` | `/api/v1/events` | Cria evento, convidados e entregas de email |
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

- O **link de gestão** é um token de 256 bits. A base de dados guarda
  apenas o HMAC. O token em claro é enviado uma única vez para o email do
  anfitrião; nunca é devolvido em JSON nem escrito em logs.
- O segredo de gestão é trocado por uma sessão `HttpOnly` curta, por
  evento (`apupu_host_<eventId>`). Operações mutáveis exigem
  `X-CSRF-Token` derivado da sessão.
- O **token de convite** é guardado em hash (lookup) e cifrado com
  AES-256-GCM (para reenvios e lembretes).
- O primeiro navegador que abre um convite fica **vinculado** a ele por
  um cookie `HttpOnly` (`apupu_guest`). Outro navegador recebe o mesmo
  `404` genérico de um link inexistente. Isto não identifica uma pessoa
  nem um dispositivo físico.
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

## Email

- `EMAIL_TRANSPORT=json` (desenvolvimento): não envia; escreve as
  mensagens renderizadas em `EMAIL_JSON_DIR` (por omissão
  `tmp/outbox/`). O conteúdo inclui links com tokens, por isso nunca é
  escrito nos logs.
- `EMAIL_TRANSPORT=smtp`: usa `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS` e `EMAIL_FROM`.

A outbox tem retries com backoff exponencial (`EMAIL_MAX_ATTEMPTS`,
`EMAIL_RETRY_BASE_MS`) e chaves idempotentes que impedem envios
duplicados.

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
├── middlewares/    asyncHandler, validate, errorHandler, hostAuth, guestAuth, CSRF
├── repositories/   SQL e mapeamento de linhas
├── routes/v1/      routers por domínio + agregador
├── schemas/        validação Zod
├── scripts/        seeds, smoke test, ciclo manual da outbox
├── services/       eventos, convites, sessão, email, lembretes, outbox
├── types/          tipos do domínio
└── utils/          tokens, cifra, datas, links, cookies
migrations/         node-pg-migrate
tests/              Vitest
backend/            especificação autoritária do produto
docs/               contrato e modelo de dados da implementação
```

## Decisões que exigem confirmação antes de produção

- Política de retenção e eliminação de dados pessoais.
- Regras de consentimento e unsubscribe para emails transacionais.
- Domínio definitivo e política de cookies same-site.
- Recuperação de acesso se o anfitrião perder o link secreto.
- Limites e acessibilidade dos templates finais.
