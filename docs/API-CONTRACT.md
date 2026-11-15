# Contrato da API — v1 (implementação)

Base: `/api/v1`. Este documento descreve o contrato efectivamente
implementado. A especificação autoritária do produto está em
[`../backend/api-contract.md`](../backend/api-contract.md); em caso de
divergência, essa prevalece.

Desde a migração de contas, coexistem dois modos de gestão:

- **Conta de anfitrião** (`/auth/*` e `/host/*` do workspace): registo e
  login com email e senha, perfil, vários eventos por conta.
- **Link secreto por evento** (`POST /host/session` e
  `GET/PATCH /host/events/{eventId}`): fluxo legado, mantido válido.

O aceite público do convite (`/public/invitations/*`) continua sem conta.

## Convenções

- Respostas de sucesso: envelope `{ "data": ... }`.
- Respostas de erro: envelope estável sem detalhes internos:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Verifique os campos indicados.",
    "fields": { "starts_at": ["A data deve ser futura."] },
    "request_id": "..."
  }
}
```

- Datas em ISO 8601 UTC; o fuso IANA do evento acompanha sempre o evento.
- Campos em `snake_case`.
- Listas paginadas devolvem `data` como array e um objeto irmão
  `pagination`:

```json
{
  "data": [],
  "pagination": { "page": 1, "page_size": 20, "total": 0, "total_pages": 0 }
}
```

  `page` começa em 1, `page_size` tem máximo 100 e a ordenação é sempre
  estável (campo de ordenação + `id` como desempate).
- `X-Request-Id` é devolvido em todas as respostas e repetido em
  `error.request_id`.
- As respostas da API usam `Cache-Control: private, no-store`.

## Códigos de erro

| HTTP | `code` | Significado |
|---|---|---|
| `400` | `invalid_json` | Corpo não é JSON válido |
| `401` | `host_session_invalid` | Sessão de gestão ou de conta ausente, expirada ou de outro evento |
| `401` | `invalid_credentials` | Email ou senha inválidos no login |
| `403` | `csrf_invalid` | Falta ou não coincide o `X-CSRF-Token` |
| `403` | `email_not_verified` | A conta ainda não confirmou o email; escrita de eventos bloqueada |
| `404` | `invitation_not_found` | Token inválido, convite revogado ou reclamado por outro navegador (resposta sempre igual) |
| `404` | `event_not_found` / `invitation_not_found` / `task_not_found` | Recurso de gestão inexistente ou não pertencente à conta |
| `409` | `event_not_scheduled`, `event_cancelled`, `event_completed`, `rsvp_deadline_passed`, `email_duplicate`, `invitation_limit_reached`, `email_already_registered` | Conflito de estado |
| `422` | `validation_failed`, `verification_invalid`, `reset_invalid` | Validação Zod ou token de uso único inválido/expirado; inclui `fields` |
| `423` | `account_locked` | Demasiadas falhas de login; bloqueio temporário |
| `429` | `rate_limited` | Limite de pedidos excedido (activo em todos os ambientes) |
| `500` | `internal_error` | Erro inesperado; sem stack trace |

## Autenticação e cookies

Há três tipos de capacidade:

1. **Sessão de conta** — emitida por `POST /auth/login`:
   - Cookie `apupu_auth`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1`.
   - Cookie `apupu_csrf_auth`: legível por JS, `Path=/api/v1`.
   - `csrf_token` é devolvido no login e em `GET /auth/session`.
2. **Sessão de gestão por evento** (legado) — o segredo do link de
   gestão é trocado por uma sessão curta:
   - Cookie `apupu_host_<eventId>`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/host`.
   - Cookie `apupu_csrf_host_<eventId>`: legível por JS, `Path=/api/v1`.
   - O segredo nunca é devolvido em JSON nem escrito em logs.
3. **Capacidade do convidado** — emitida no primeiro claim:
   - Cookie `apupu_guest`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/public/invitations`.
   - Cookie `apupu_csrf_guest`: legível por JS, `Path=/api/v1`.
   - É reutilizada pelo mesmo navegador para reclamar convites adicionais.

Pedidos mutáveis autenticados por cookie exigem o cabeçalho
`X-CSRF-Token` com o valor derivado (`csrf_token` devolvido em JSON e no
cookie legível). O valor esperado é recalculado no servidor a partir da
capacidade `HttpOnly`; um site cross-site não o consegue ler.

As rotas `GET/PATCH /host/events/{eventId}` e as rotas de convidados por
evento aceitam **qualquer** das duas sessões de anfitrião: primeiro a
sessão legada do evento, depois a sessão de conta com verificação de
`events.host_id`. Uma conta válida sem posse do evento recebe `404`
`event_not_found`; sem sessão válida, `401` genérico. As rotas de
workspace (`/host/events` sem `:eventId`, `/host/profile`,
`/host/dashboard`, `/host/guests`, `/host/activity`, `/host/reports`,
`/host/tasks`) usam apenas a sessão de conta.

## Conta do anfitrião

### Registo e verificação

`POST /api/v1/auth/register`

```json
{ "email": "ana@exemplo.ao", "password": "…", "display_name": "Ana" }
```

- Cria a conta e o perfil, enfileira o email de verificação e o email de
  boas-vindas. **Não** inicia sessão.
- A senha exige 8 a 128 caracteres e não pode estar na lista mínima de
  senhas comuns.
- `409 email_already_registered` se o email já existir.

Resposta `201`:

```json
{ "data": { "host": { "id": "...", "email": "...", "email_verified": false, "profile": { "...": "..." }, "profile_complete": false, "missing_fields": ["birth_date"] } } }
```

`POST /api/v1/auth/email/verify` consome `{ "token": "..." }` e devolve
`200` com a conta já verificada. Só depois da verificação os eventos
legados com o mesmo `host_email` são ligados à conta
(`events.host_id`), de forma idempotente. Token inválido/expirado:
`422 verification_invalid`.

`POST /api/v1/auth/email/verify/resend` recebe `{ "email": "..." }` e
responde sempre `202 { "data": { "status": "accepted" } }`, exista ou
não a conta.

### Login, sessão e logout

`POST /api/v1/auth/login`

```json
{ "email": "ana@exemplo.ao", "password": "…" }
```

Resposta `200` (define `apupu_auth` e `apupu_csrf_auth`):

```json
{
  "data": {
    "host": { "...": "..." },
    "csrf_token": "<valor para X-CSRF-Token>",
    "expires_at": "2026-11-22T03:24:23.287Z"
  }
}
```

- O login é permitido com email por verificar.
- `401 invalid_credentials` para email/senha inválidos (a mesma resposta
  para email inexistente, senha errada ou conta suspensa).
- `423 account_locked` após `AUTH_MAX_FAILED_LOGINS` falhas seguidas,
  durante `AUTH_LOCK_MINUTES`.

`GET /api/v1/auth/session` devolve a conta autenticada e o `csrf_token`
atual. `POST /api/v1/auth/logout` revoga a sessão, limpa os cookies e
responde `204`; exige `X-CSRF-Token`.

### Reposição e alteração de senha

| Método | Rota | Efeito |
|---|---|---|
| `POST` | `/api/v1/auth/password/forgot` | Enfileira o email de reposição; responde sempre `202` |
| `POST` | `/api/v1/auth/password/reset` | Consome o token, define a nova senha e revoga todas as sessões |
| `POST` | `/api/v1/auth/password/change` | Altera a senha autenticada e revoga as outras sessões |

- `forgot` recebe `{ "email": "..." }`; a resposta é sempre a mesma para
  não revelar se a conta existe.
- `reset` recebe `{ "token": "...", "password": "..." }`; token inválido
  ou expirado devolve `422 reset_invalid`.
- `change` exige sessão e `X-CSRF-Token`, recebe
  `{ "current_password": "...", "new_password": "..." }` e responde
  `204`. Senha atual errada devolve `422` com o campo
  `current_password`.

### Perfil

`GET /api/v1/host/profile` devolve `{ "data": { "host": { ... } } }`.

`PATCH /api/v1/host/profile` aceita apenas os campos enviados
(`display_name`, `phone`, `birth_date`, `locale`, `timezone`,
`avatar_url`); a ausência mantém o valor atual e `null` limpa o campo.

- `birth_date` é uma data de calendário `YYYY-MM-DD`, no passado e com a
  idade mínima `MIN_HOST_AGE_YEARS` (por omissão 18). É opcional e não
  bloqueia o uso da conta.
- `profile_complete` é `false` enquanto `birth_date` estiver em falta;
  `missing_fields` lista os campos em falta (atualmente só
  `birth_date`).
- `POST /api/v1/host/profile/avatar` recebe `{ "avatar_url": "https://…" }`
  e define o avatar (não há upload de ficheiros nesta fase).

### Workspace

Todas as rotas abaixo exigem sessão de conta; as mutações exigem também
`X-CSRF-Token`. O `host_id` vem sempre da sessão.

| Método | Rota | Efeito |
|---|---|---|
| `GET` | `/api/v1/host/events` | Lista paginada dos eventos da conta |
| `POST` | `/api/v1/host/events` | Cria evento na conta; exige email verificado |
| `DELETE` | `/api/v1/host/events/{eventId}` | Apaga evento e dados em cascata; exige email verificado |
| `GET` | `/api/v1/host/dashboard` | Próximo evento, próximos eventos e totais |
| `GET` | `/api/v1/host/guests` | Lista paginada de convidados de todos os eventos |
| `GET` | `/api/v1/host/activity` | Feed de actividade da conta (paginado) |
| `GET` | `/api/v1/host/events/{eventId}/activity` | Feed de actividade do evento (paginado) |
| `GET` | `/api/v1/host/reports/summary` | Agregados por evento e taxas |
| `GET` | `/api/v1/host/events/{eventId}/reports` | Série diária do evento |
| `GET` | `/api/v1/host/tasks` | Tarefas da conta (filtro opcional `event_id`) |
| `POST` | `/api/v1/host/tasks` | Cria tarefa |
| `PATCH` | `/api/v1/host/tasks/{taskId}` | Atualiza descrição/estado |
| `DELETE` | `/api/v1/host/tasks/{taskId}` | Remove tarefa |

Parâmetros de lista:

- Eventos: `status`, `q`, `sort` (`starts_at` \| `created_at`), `order`
  (`asc` \| `desc`), `page`, `page_size`.
- Convidados: `event_id`, `rsvp_status`, `send_status`, `q`, `page`,
  `page_size`.
- Relatório diário: `days` (1 a 365, por omissão 30); a série usa dias
  UTC, um ponto por dia, incluindo dias sem movimento.

Criar um evento autenticado devolve o mesmo envelope de
`POST /events` (`event`, `manage_email_status`, `deliveries`); o link de
gestão continua a ser enviado para `host_email`. Antes da verificação do
email, a criação/remoção devolve `403 email_not_verified`.

### Categorias e mesas

- `events.category` é opcional: `wedding`, `birthday`, `corporate`,
  `baby` ou `other`.
- `invitations.table_name` é opcional e acompanha o convite (por
  exemplo, "Mesa 1"); não é enviado ao convidado na página pública.

## Fluxo do anfitrião (link secreto)

### 1. Criar evento

`POST /api/v1/events` (público, sem conta) ou
`POST /api/v1/host/events` (conta autenticada, email verificado).

```json
{
  "event": {
    "title": "Casamento da Ana e do Paulo",
    "host_name": "Ana",
    "host_email": "ana@exemplo.ao",
    "category": "wedding",
    "starts_at": "2027-08-15T18:00:00+01:00",
    "ends_at": "2027-08-16T02:00:00+01:00",
    "timezone": "Africa/Luanda",
    "location": { "type": "venue", "name": "Salão Principal", "address": "Luanda" },
    "message": "Celebramos o nosso casamento.",
    "rules": "Traje formal.",
    "dress_code": "Traje formal",
    "template_id": null,
    "theme": { "mode": "dark", "palette": "default" },
    "contribution": { "enabled": false },
    "rsvp_deadline": "2027-08-01T23:59:59+01:00"
  },
  "guests": [
    { "name": "João", "email": "joao@exemplo.ao", "phone": null, "table_name": "Mesa 1" }
  ]
}
```

Regras de validação relevantes:

- `location.type=venue` exige `name`; `location.type=online` exige
  `online_url`.
- `contribution.enabled=true` exige `bank_name`, `account_holder` e
  `account_reference`.
- `ends_at` tem de ser posterior a `starts_at`; `rsvp_deadline` não pode
  ser posterior a `starts_at`.
- `starts_at` tem de ser futura.
- Emails de convidados duplicados são rejeitados.
- Campos desconhecidos são rejeitados (`.strict()`).

Resposta `201`:

```json
{
  "data": {
    "event": { "id": "...", "title": "...", "status": "scheduled", "...": "..." },
    "manage_email_status": "sent",
    "deliveries": [
      { "email": "joao@exemplo.ao", "status": "queued" }
    ]
  }
}
```

O segredo de gestão **não** é devolvido: é enviado uma única vez para
`host_email` no link de gestão. O envio é síncrono e o resultado é
comunicado em `manage_email_status` (`sent` | `failed`). Os convites são
enfileirados na outbox e reportados como `queued`, `sent` ou `failed`.

### 2. Trocar o link secreto por sessão

`POST /api/v1/host/session`

```json
{ "token": "<segredo do link de gestão>" }
```

Resposta `200` (define os cookies do evento):

```json
{
  "data": {
    "event": { "...": "..." },
    "csrf_token": "<valor para X-CSRF-Token>",
    "expires_at": "2027-08-15T20:00:00.000Z"
  }
}
```

`DELETE /api/v1/host/session/{eventId}` revoga a sessão e limpa os
cookies. Exige `X-CSRF-Token`.

### 3. Consultar e actualizar o evento

`GET /api/v1/host/events/{eventId}`

Resposta `200`:

```json
{
  "data": {
    "event": {
      "...": "...",
      "stats": {
        "total_invitations": 10,
        "accepted": 4,
        "declined": 2,
        "pending": 4
      }
    },
    "invitations": [{ "...": "..." }]
  }
}
```

`PATCH /api/v1/host/events/{eventId}` actualiza apenas os campos
enviados (sem defaults implícitos) e aceita `status`
(`draft`, `scheduled`, `cancelled`, `completed`). Exige `X-CSRF-Token`.

- Alterar `starts_at` ou `timezone` cancela e reconstrói os lembretes
  futuros ainda não enviados.
- `status=draft` suspende convites e lembretes pendentes; voltar a
  `scheduled` reagenda os lembretes futuros.
- `status=cancelled` cancela convites/lembretes pendentes e enfileira o
  aviso de cancelamento aos convidados que não recusaram.
- `status=completed` cancela convites/lembretes pendentes.
- `theme` e `contribution` são fundidos com o estado actual.

### 4. Gerir convidados

| Método | Rota | Efeito |
|---|---|---|
| `GET` | `/api/v1/host/events/{eventId}/invitations` | Lista privada |
| `POST` | `/api/v1/host/events/{eventId}/invitations` | Adiciona e enfileira convite |
| `PATCH` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | Actualiza dados |
| `DELETE` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | Remove convite e entregas |
| `POST` | `.../{invitationId}/resend` | Reenvia o link individual |
| `POST` | `.../{invitationId}/revoke` | Revoga o acesso do navegador |

Payload de criação/actualização:

```json
{ "name": "João", "email": "joao@exemplo.ao", "phone": "+244900000000", "table_name": "Mesa 1" }
```

Só é possível adicionar convidados a um evento `scheduled`. O limite é
`MAX_INVITATIONS_PER_EVENT`. Todas as rotas mutáveis exigem
`X-CSRF-Token`.

## Fluxo do convidado

### Reclamar o convite

`POST /api/v1/public/invitations/{token}/claim`

- O primeiro claim válido é atómico e emite a capacidade do navegador.
- Token inválido, convite revogado ou já reclamado por outro navegador
  devolvem sempre o mesmo `404` genérico (`invitation_not_found`).
- O mesmo navegador pode reabrir o convite e reclamar convites
  adicionais com a mesma capacidade.

Resposta `200`:

```json
{
  "data": {
    "event": { "id": "...", "title": "...", "starts_at": "...", "timezone": "Africa/Luanda" },
    "guest": { "name": "João", "rsvp_status": "pending", "rsvp_responded_at": null },
    "rsvp_deadline_passed": false,
    "csrf_token": "<valor para X-CSRF-Token>"
  }
}
```

### Consultar o convite

`GET /api/v1/public/invitations/{token}` — exige a capacidade do
navegador. Devolve a mesma apresentação pública, sem email, telefone ou
dados de outros convidados.

### Responder

`PUT /api/v1/public/invitations/{token}/rsvp`

```json
{ "status": "accepted" }
```

- `status`: `accepted` | `declined`.
- Exige a capacidade do navegador e `X-CSRF-Token`.
- Repetir o mesmo estado é idempotente.
- `declined` cancela os lembretes futuros do convite e notifica o
  anfitrião por email.
- Voltar de `declined` para `accepted` reagenda os lembretes futuros.
- `409` se o evento estiver cancelado/terminado ou o prazo tiver
  passado.

## Templates

`GET /api/v1/templates` — lista apenas templates activos, com os campos
e temas suportados. Uma lista vazia é válida. Os templates visuais finais
serão fornecidos pelo responsável do produto.

## Rate limit

Todos os ambientes aplicam `/api/v1`:

- Global: `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`.
- Endpoints públicos com token: `PUBLIC_RATE_LIMIT_WINDOW_MS` /
  `PUBLIC_RATE_LIMIT_MAX`.
- Troca do segredo de gestão: `HOST_SESSION_RATE_LIMIT_WINDOW_MS` /
  `HOST_SESSION_RATE_LIMIT_MAX`.
- Autenticação (`register`, `login`, `email/verify/resend`,
  `password/forgot`): `AUTH_RATE_LIMIT_WINDOW_MS` /
  `AUTH_RATE_LIMIT_MAX`, aplicado por IP e por IP + email.
- Verificação de email e reposição de senha consomem também o limite
  público de tokens.

`/health` fica fora do limite global para não afectar orquestradores.
