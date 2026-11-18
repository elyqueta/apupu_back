# Conto Contigo — Contrato da API v1 (implementação)

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
| `403` | `forbidden` | Origem não permitida pelo CORS |
| `403` | `email_not_verified` | A conta ainda não confirmou o email; escrita de eventos bloqueada |
| `403` | `host_action_forbidden` | A ação está reservada ao anfitrião (proprietário); um gestor tentou executá-la |
| `404` | `invitation_not_found` | Token inválido, convite revogado ou reclamado por outro navegador (resposta sempre igual) |
| `404` | `manage_link_invalid` | Link de gestão inválido, expirado ou já rodado |
| `404` | `event_not_found` / `invitation_not_found` / `task_not_found` / `manager_not_found` / `notification_not_found` / `activity_not_found` | Recurso de gestão inexistente ou não pertencente à conta |
| `404` | `route_not_found` | Rota inexistente |
| `409` | `event_not_scheduled`, `event_cancelled`, `event_completed`, `rsvp_deadline_passed`, `invitation_email_duplicate`, `invitation_limit_reached`, `invitation_host_email`, `email_already_registered` | Conflito de estado |
| `409` | `invitation_revoked`, `invitation_not_resendable` | Convite revogado ou sem link reutilizável para reenvio |
| `409` | `manager_already_exists` | O email já é gestor activo do evento |
| `422` | `validation_failed` | Validação Zod; inclui `fields` |
| `422` | `verification_invalid`, `reset_invalid` | Token de uso único inválido ou expirado |
| `422` | `verification_required` | É necessário verificar o email antes de criar a conta |
| `422` | `otp_invalid` | Código OTP inválido ou expirado |
| `422` | `otp_attempts_exceeded` | Limite de tentativas do código atingido; pedir novo código |
| `423` | `account_locked` | Demasiadas falhas de login; bloqueio temporário |
| `429` | `rate_limited` | Limite de pedidos excedido (activo em todos os ambientes) |
| `429` | `otp_resend_too_soon` | Pedido de novo código antes do intervalo mínimo |
| `500` | `internal_error` | Erro inesperado; sem stack trace |
| `503` | `avatar_upload_unavailable` | Upload de avatar indisponível: credenciais Cloudinary ausentes ou provider inacessível |
| `503` | `profile_cover_upload_unavailable` | Upload da capa do perfil indisponível: credenciais Cloudinary ausentes ou provider inacessível |
| `503` | `event_cover_upload_unavailable` | Upload da imagem de capa indisponível: credenciais Cloudinary ausentes ou provider inacessível |

## Autenticação e cookies

Há três tipos de capacidade:

1. **Sessão de conta** — emitida por `POST /auth/login` e,
   automaticamente, por `POST /auth/register` após a verificação OTP:
   - Cookie `apupu_auth`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1`.
   - Cookie `apupu_csrf_auth`: legível por JS, `Path=/api/v1`.
   - `csrf_token` e `expires_at` são devolvidos no login e no registo;
     `csrf_token` também é devolvido em `GET /auth/session`.
   - O token bruto da sessão nunca é devolvido em JSON.
2. **Sessão de gestão por evento** — o segredo de um link de gestão
   (do anfitrião ou de um gestor) é trocado por uma sessão curta:
   - Cookie `apupu_host_<eventId>`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/host`.
   - Cookie `apupu_csrf_host_<eventId>`: legível por JS, `Path=/api/v1`.
   - O segredo nunca é devolvido em JSON nem escrito em logs.
   - A sessão tem um papel (`host` ou `manager`). O link do anfitrião
     roda ao ser usado; o link de um gestor não roda e pode ser
     reutilizado enquanto não for removido ou expirar.
3. **Capacidade do convidado** — emitida no primeiro claim:
   - Cookie `apupu_guest`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/public/invitations`.
   - Cookie `apupu_csrf_guest`: legível por JS, `Path=/api/v1`.
   - É reutilizada pelo mesmo navegador para reclamar convites adicionais.

Pedidos mutáveis autenticados por cookie exigem o cabeçalho
`X-CSRF-Token` com o valor derivado (`csrf_token` devolvido em JSON e no
cookie legível). O valor esperado é recalculado no servidor a partir da
capacidade `HttpOnly`; um site cross-site não o consegue ler.

As rotas `GET/PATCH /host/events/{eventId}`, `GET /host/events/{eventId}/activity`
e as rotas de convidados por evento aceitam **qualquer** das duas sessões de
anfitrião: primeiro a sessão legada do evento, depois a sessão de conta com
verificação de `events.host_id`. Uma conta válida sem posse do evento recebe
`404 event_not_found`; sem sessão válida, `401` genérico. As rotas de
workspace (`/host/events` sem `:eventId`, `/host/profile`,
`/host/dashboard`, `/host/guests`, `/host/invitations`, `/host/activity`,
`/host/reports`, `/host/tasks`) usam apenas a sessão de conta.

## Conta do anfitrião

### Registo e verificação

O registo tem três passos. A conta **só é criada** depois de o email
ser verificado por código OTP — excepto quando o email já foi inscrito
por um anfitrião num evento. Nesse caso o convite serve de prova de
posse, o OTP é dispensado e o nome do convite pré-preenche o formulário.

#### 1. Pedir o código

`POST /api/v1/auth/register/request-code`

```json
{ "email": "ana@exemplo.ao" }
```

- Valida o formato do email e confirma que ainda não existe conta.
- Invalida qualquer código anterior do mesmo email.
- Envia um código numérico de 6 dígitos, válido por
  `REGISTRATION_OTP_TTL_MINUTES` minutos (por omissão 10).
- O código é enviado exclusivamente por email, com um link
  `https://apupu-front.vercel.app/criar-conta?email=...&codigo=...` que
  pré-preenche o ecrã de verificação. O código **nunca** é devolvido na
  resposta da API.
- Um novo pedido antes de `REGISTRATION_OTP_RESEND_SECONDS` segundos
  (por omissão 60) devolve `429 otp_resend_too_soon`.

Resposta `202`:

```json
{
  "data": {
    "status": "accepted",
    "email": "ana@exemplo.ao",
    "expires_at": "2026-11-16T02:30:30.588Z",
    "resend_available_at": "2026-11-16T02:20:30.586Z"
  }
}
```

> Não existe `dev_code`: o código só existe no email. O frontend deve
> ler `email`/`codigo` da query string do link para abrir directamente o
> passo de verificação.

Erros: `409 email_already_registered`, `422 validation_failed`,
`429 otp_resend_too_soon` ou `429 rate_limited`.

#### 1b. Email já inscrito por um anfitrião

Quando o email já consta num convite (`invitations.guest_email`), o
convite é aceite como prova de posse: não é enviado OTP e a resposta é
`200` com o token de registo e o nome do convite.

```json
{
  "data": {
    "status": "guest_verified",
    "email": "ana@exemplo.ao",
    "display_name": "Ana Silva",
    "verification_token": "DKNAPJMDeXHmDxeIQDvxMsD47GYjqtzgGwh3gWlPr2I",
    "expires_at": "2026-11-16T02:35:49.786Z"
  }
}
```

O frontend guarda o `verification_token`, pré-preenche `display_name` e
salta directamente para o passo 3 (definir senha). O passo 2 não é
executado.

#### 2. Verificar o código

`POST /api/v1/auth/register/verify-code`

```json
{ "email": "ana@exemplo.ao", "code": "004271" }
```

- O código tem exactamente 6 dígitos.
- Após `REGISTRATION_OTP_MAX_ATTEMPTS` falhas (por omissão 5) o código
  é invalidado e é necessário pedir um novo.
- O sucesso devolve um `verification_token` de uso único, válido por
  `REGISTRATION_VERIFICATION_TTL_MINUTES` minutos (por omissão 15).

Resposta `200`:

```json
{
  "data": {
    "email": "ana@exemplo.ao",
    "verification_token": "DKNAPJMDeXHmDxeIQDvxMsD47GYjqtzgGwh3gWlPr2I",
    "expires_at": "2026-11-16T02:35:49.786Z"
  }
}
```

Erros: `422 otp_invalid`, `422 otp_attempts_exceeded`,
`422 validation_failed`, `429 rate_limited`.

#### 3. Criar a conta

`POST /api/v1/auth/register`

```json
{
  "email": "ana@exemplo.ao",
  "password": "…",
  "display_name": "Ana",
  "verification_token": "DKNAPJMDeXHmDxeIQDvxMsD47GYjqtzgGwh3gWlPr2I"
}
```

- Exige o `verification_token` do passo anterior. Sem ele, ou se já
  tiver sido usado/expirado, devolve `422 verification_required`.
- A conta é criada já com `email_verified=true`; não é enviado um link
  de verificação.
- Os eventos legados cujo `host_email` coincide com o email verificado
  são ligados à conta (`events.host_id`) de forma idempotente.
- O email de boas-vindas é enfileirado e é criada uma sessão de conta na
  mesma transacção. O cookie é HttpOnly; o token bruto não é devolvido em
  JSON.
- A senha exige 8 a 128 caracteres e não pode estar na lista mínima de
  senhas comuns.

Resposta `201`:

```json
{
  "data": {
    "host": {
      "id": "db5a9bcc-82c0-46c2-80d5-de7ff164f14a",
      "email": "ana@exemplo.ao",
      "email_verified": true,
      "status": "active",
      "profile": {
        "display_name": "Ana",
        "phone": null,
        "birth_date": null,
        "locale": "pt-AO",
        "timezone": "Africa/Luanda",
        "avatar_url": null
      },
      "profile_complete": false,
      "missing_fields": ["birth_date"],
      "created_at": "2026-11-16T02:20:57.546Z"
    },
    "csrf_token": "<valor para X-CSRF-Token>",
    "expires_at": "2026-11-23T02:20:57.546Z"
  }
}
```

Erros: `409 email_already_registered`, `422 verification_required`,
`422 validation_failed`, `429 rate_limited`.

#### Contas antigas por verificar

`POST /api/v1/auth/email/verify` consome `{ "token": "..." }` e devolve
`200` com a conta já verificada. Continua disponível para contas
criadas antes deste fluxo. Token inválido/expirado:
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
`avatar_url`, `cover_url`); a ausência mantém o valor atual e `null`
limpa o campo.

- `birth_date` é uma data de calendário `YYYY-MM-DD`, no passado e com a
  idade mínima `MIN_HOST_AGE_YEARS` (por omissão 18). É opcional e não
  bloqueia o uso da conta.
- `profile_complete` é `false` enquanto `birth_date` estiver em falta;
  `missing_fields` lista os campos em falta (atualmente só
  `birth_date`).
- `POST /api/v1/host/profile/avatar` recebe `{ "avatar_url": "https://…" }`
  e define o avatar por URL.
- `POST /api/v1/host/profile/avatar/upload` recebe
  `multipart/form-data` no campo `avatar` (JPEG, PNG ou WebP, até
  `AVATAR_MAX_BYTES`). O backend assina o upload para o Cloudinary e
  devolve o perfil já com o URL seguro; o API secret nunca sai do
  servidor. Sem `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e
  `CLOUDINARY_API_SECRET` responde `503 avatar_upload_unavailable`, sem
  afectar o avatar por URL.
- `POST /api/v1/host/profile/cover` recebe `{ "cover_url": "https://…" }`
  e define a imagem de capa por URL (idempotente para o mesmo URL).
- `POST /api/v1/host/profile/cover/upload` recebe `multipart/form-data`
  no campo `cover` (JPEG, PNG ou WebP, até `PROFILE_COVER_MAX_BYTES`).
  O upload é idempotente por conteúdo (SHA-256); sem credenciais
  Cloudinary responde `503 profile_cover_upload_unavailable`.
- `DELETE /api/v1/host/profile/cover` remove a capa (idempotente).

### Workspace

Todas as rotas abaixo exigem sessão de conta; as mutações exigem também
`X-CSRF-Token`. O `host_id` vem sempre da sessão.

As leituras (`GET`) incluem os eventos próprios da conta e aqueles em
que a conta é **gestora activa** — ou seja, o email verificado da conta
foi adicionado como gestor pelo anfitrião. As mutações estruturais
(criar, apagar, reenviar o link do anfitrião e gerir gestores) continuam
reservadas ao proprietário.

As tarefas pertencem sempre ao anfitrião (`host_id`), mas podem ser
atribuídas a um gestor de um evento (`manager_id`). O anfitrião vê e
gere todas as suas tarefas; um gestor vê apenas as que lhe foram
atribuídas e só pode marcar `done`. A listagem global pagina, filtra e
pesquisa.

| Método | Rota | Efeito |
|---|---|---|
| `GET` | `/api/v1/host/events` | Lista paginada dos eventos acessíveis à conta (próprios e geridos) |
| `POST` | `/api/v1/host/events` | Cria evento na conta; exige email verificado |
| `DELETE` | `/api/v1/host/events/{eventId}` | Apaga evento e dados em cascata; exige email verificado e posse |
| `POST` | `/api/v1/host/events/{eventId}/manage-link/resend` | Emite e envia um novo link de gestão; invalida o anterior; só o anfitrião |
| `GET` | `/api/v1/host/events/{eventId}/managers` | Lista os gestores activos; só o anfitrião |
| `GET` | `/api/v1/host/managers` | Lista os gestores de todos os eventos da conta; só o anfitrião |
| `POST` | `/api/v1/host/events/{eventId}/managers` | Adiciona um gestor por email e enfileira o convite; só o anfitrião |
| `DELETE` | `/api/v1/host/events/{eventId}/managers/{managerId}` | Remove o acesso de um gestor; só o anfitrião |
| `POST` | `/api/v1/host/events/{eventId}/managers/{managerId}/resend` | Emite um novo link para o gestor; só o anfitrião |
| `GET` | `/api/v1/host/dashboard` | Próximo evento, próximos eventos e totais |
| `GET` | `/api/v1/host/guests` | Lista paginada de convidados de todos os eventos acessíveis |
| `GET` | `/api/v1/host/invitations` | "Meus convites": eventos em que a conta foi convidada |
| `GET` | `/api/v1/host/activity` | Feed de actividade da conta (paginado) |
| `GET` | `/api/v1/host/events/{eventId}/activity` | Feed de actividade do evento (paginado) |
| `DELETE` | `/api/v1/host/events/{eventId}/activity/{activityId}` | Elimina uma actividade do evento; só o anfitrião, na gestão do evento |
| `PUT` | `/api/v1/host/events/{eventId}/cover` | Define a capa por URL (idempotente) |
| `POST` | `/api/v1/host/events/{eventId}/cover/upload` | Carrega a capa por `multipart/form-data` |
| `DELETE` | `/api/v1/host/events/{eventId}/cover` | Remove a capa (idempotente) |
| `GET` | `/api/v1/host/reports/summary` | Agregados por evento e taxas |
| `GET` | `/api/v1/host/reports/export` | Exporta o resumo em PDF ou CSV |
| `GET` | `/api/v1/host/events/{eventId}/exports/{document}` | Exporta um documento do evento em PDF ou CSV (`guests`, `summary`, `attendance`, `ticket`) |
| `GET` | `/api/v1/host/events/{eventId}/reports` | Série diária do evento |
| `GET` | `/api/v1/host/notifications` | Notificações da conta (paginadas, com filtros e pesquisa) |
| `GET` | `/api/v1/host/notifications/unread-count` | Contagem de notificações não lidas |
| `PATCH` | `/api/v1/host/notifications/{notificationId}` | Marca uma notificação como lida/não lida |
| `DELETE` | `/api/v1/host/notifications/{notificationId}` | Remove uma notificação |
| `POST` | `/api/v1/host/notifications/read-all` | Marca todas como lidas |
| `DELETE` | `/api/v1/host/notifications` | Limpa todas as notificações |
| `GET` | `/api/v1/host/tasks` | Tarefas da conta/gestor (paginadas, com filtros e pesquisa) |
| `POST` | `/api/v1/host/tasks` | Cria tarefa (só o anfitrião) |
| `PATCH` | `/api/v1/host/tasks/{taskId}` | Actualiza descrição/estado |
| `DELETE` | `/api/v1/host/tasks/{taskId}` | Remove tarefa (só o anfitrião) |

Parâmetros de lista:

- Eventos: `status`, `q`, `sort` (`starts_at` \| `created_at`), `order`
  (`asc` \| `desc`), `page`, `page_size`.
- Convidados: `event_id`, `rsvp_status`, `send_status`, `q`, `page`,
  `page_size`.
- "Meus convites": `sort` (`starts_at`), `order` (`asc` \| `desc`,
  omissão `asc`), `page`, `page_size`. Não há filtro por email: a lista
  é sempre a do email da conta autenticada.
- Relatório diário: `days` (1 a 365, por omissão 30); a série usa dias
  UTC, um ponto por dia, incluindo dias sem movimento.
- Exportação do relatório: `format` (`pdf` \| `csv`, omissão `pdf`).
- Exportação por evento: `document` no caminho (`guests` \| `summary` \|
  `attendance` \| `ticket`), `format` (`pdf` \| `csv`, omissão `pdf`) e
  `invitation_id` (obrigatório apenas em `ticket`).
- Tarefas: `event_id`, `status` (`all` \| `pending` \| `done`, omissão
  `all`), `assignee` (`all` \| `host` \| `manager`, omissão `all`),
  `manager_id`, `q`, `page`, `page_size`. A resposta é
  `{ data, pagination }`.
- Notificações: `status` (`all` \| `unread` \| `read`), `kind`,
  `event_id`, `q`, `page`, `page_size`. A resposta é
  `{ data, pagination, unread_count }`.

Criar um evento autenticado devolve o mesmo envelope de
`POST /events` (`event`, `manage_email_status`, `deliveries`); o link de
gestão continua a ser enviado para `host_email`. Antes da verificação do
email, a criação/remoção devolve `403 email_not_verified`.

O corpo de `POST /api/v1/host/events` aceita `event.cover_url` opcional
(URL `https`), pelo que a capa pode ser definida logo na criação. Os
endpoints dedicados de capa continuam disponíveis para substituir ou
remover a imagem depois.

#### Respostas do workspace

`GET /api/v1/host/events` — cada item é um `Event` com `stats`:

```json
{
  "data": [
    {
      "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "title": "Casamento da Ana e do Paulo",
      "host_name": "Ana",
      "host_email": "ana@exemplo.ao",
      "category": "wedding",
      "starts_at": "2027-08-15T17:00:00.000Z",
      "ends_at": "2027-08-16T01:00:00.000Z",
      "timezone": "Africa/Luanda",
      "location": {
        "type": "venue",
        "name": "Salão Principal",
        "address": "Luanda",
        "online_url": null
      },
      "message": "Celebramos o nosso casamento.",
      "rules": "Traje formal.",
      "dress_code": "Traje formal",
      "template_id": null,
      "theme": { "mode": "dark", "palette": "default" },
      "contribution": { "enabled": false },
      "rsvp_deadline": "2027-08-01T22:59:59.000Z",
      "status": "scheduled",
      "access_role": "host",
      "created_at": "2026-11-16T01:40:07.999Z",
      "updated_at": "2026-11-16T01:40:07.999Z",
      "stats": {
        "total_invitations": 10,
        "accepted": 4,
        "declined": 2,
        "pending": 4
      }
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 }
}
```

Cada evento traz `access_role`: `host` quando a conta é proprietária,
`manager` quando participa como gestora. O cliente usa este campo para
esconder as ações reservadas ao anfitrião.

`POST /api/v1/host/events` — `201`:

```json
{
  "data": {
    "event": { "id": "...", "title": "...", "status": "scheduled", "...": "..." },
    "manage_email_status": "queued",
    "deliveries": [
      { "email": "joao@exemplo.ao", "status": "queued" }
    ]
  }
}
```

`DELETE /api/v1/host/events/{eventId}` — `204`, sem corpo.

`POST /api/v1/host/events/{eventId}/manage-link/resend` — `202`:

```json
{
  "data": {
    "event_id": "87b7165f-90fb-4859-ad63-7aa9cc3b657e",
    "manage_email_status": "queued",
    "manage_token_expires_at": "2026-12-16T01:40:08.075Z"
  }
}
```

- Gera um token novo, envia-o para `host_email` e invalida o anterior.
- `404 event_not_found` se o evento não pertencer à conta.
- `403 email_not_verified` antes da verificação.
- O token nunca aparece na resposta.

#### Gestores de evento

O anfitrião pode delegar a gestão de um evento a outras pessoas,
identificadas pelo email. Um gestor **não precisa de conta**: recebe um
link próprio e usa a área de gestão por link. Se mais tarde criar uma
conta com o mesmo email verificado, o evento passa também a aparecer no
workspace dela e continua a poder ser gerido de ambas as formas.

Permissões:

| Capacidade | Anfitrião | Gestor |
|---|---|---|
| Consultar evento, convidados, actividade e relatórios | sim | sim |
| Editar informações do evento | sim | sim |
| Adicionar convidados | sim | sim |
| Alterar `status` ou `host_email` | sim | não |
| Cancelar/apagar o evento | sim | não |
| Update/delete/resend/revoke de convites existentes | sim | não |
| Reenviar o link de gestão do anfitrião | sim | não |
| Gerir gestores | sim | não |

Qualquer tentativa de um gestor executar uma ação reservada devolve
`403 host_action_forbidden`.

`GET /api/v1/host/events/{eventId}/managers` — `200`:

```json
{
  "data": [
    {
      "id": "b2d5f4a1-3c47-4a3e-9c2d-1f2a3b4c5d6e",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "email": "paulo@exemplo.ao",
      "has_account": false,
      "last_used_at": null,
      "created_at": "2026-11-16T01:40:07.999Z",
      "updated_at": "2026-11-16T01:40:07.999Z"
    }
  ]
}
```

`POST /api/v1/host/events/{eventId}/managers` — corpo
`{ "email": "paulo@exemplo.ao" }`, resposta `201`:

```json
{
  "data": {
    "manager": { "id": "...", "email": "paulo@exemplo.ao", "has_account": false, "...": "..." },
    "invite_email_status": "queued"
  }
}
```

- O email é normalizado para minúsculas e comparado sem distinção de
  maiúsculas (`citext`).
- Ao adicionar ou reativar um gestor, se ainda não existir convite para
  esse email no evento, é criado automaticamente um convite de convidado
  (nome derivado da parte local do email) e enfileiradas as mensagens de
  onboarding. Se já existir convite, nada é duplicado. O gestor recebe
  tanto o link de gestão como o convite de convidado.
- `409 manager_already_exists` se o email já for gestor activo.
- `422 validation_failed` se o email for inválido ou igual ao do
  anfitrião.
- O link é enfileirado na outbox e o token nunca é devolvido em JSON.
- `has_account=true` indica que já existe uma conta verificada com o
  mesmo email; o evento passa a aparecer no workspace dessa conta.

`DELETE /api/v1/host/events/{eventId}/managers/{managerId}` — `204`,
sem corpo. A remoção é lógica: o link deixa de funcionar e as sessões
abertas por esse gestor são revogadas. O mesmo email pode voltar a ser
adicionado mais tarde (reativa a linha e emite um link novo).

`POST /api/v1/host/events/{eventId}/managers/{managerId}/resend` — `202`,
mesmo envelope de `POST` com `invite_email_status`. Emite um link novo,
invalida o anterior e enfileira o email.

Todas as rotas de gestores devolvem `404 event_not_found` quando o
evento não pertence à conta e `404 manager_not_found` quando o gestor
não existe, foi removido ou pertence a outro evento.

`GET /api/v1/host/dashboard` — `200`:

```json
{
  "data": {
    "next_event": { "id": "...", "title": "...", "stats": { "...": 0 } },
    "upcoming": [{ "id": "...", "title": "...", "stats": { "...": 0 } }],
    "totals": {
      "events": 3,
      "drafts": 0,
      "scheduled": 2,
      "cancelled": 1,
      "completed": 0,
      "total_invitations": 30,
      "accepted": 12,
      "declined": 3,
      "pending": 15
    }
  }
}
```

- `next_event` é `null` quando não há eventos futuros agendados.
- `upcoming` devolve no máximo 5 eventos, do mais próximo para o mais
  distante.

`GET /api/v1/host/guests` — `200`; cada item é um `Invitation` com um
resumo do evento:

```json
{
  "data": [
    {
      "id": "1a80b39f-cb8c-49d2-86ff-cf4de1b74803",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "guest_name": "João",
      "guest_email": "joao@exemplo.ao",
      "guest_phone": "+244900000000",
      "table_name": "Mesa 1",
      "rsvp_status": "accepted",
      "rsvp_responded_at": "2026-11-16T01:00:00.000Z",
      "send_status": "sent",
      "send_count": 1,
      "last_sent_at": "2026-11-15T03:24:52.807Z",
      "opened_at": "2026-11-16T01:00:00.000Z",
      "invitation_url": "https://apupu-front.vercel.app/convite/3f9c2a7e5b1d4c8fa6e0",
      "invitation_url_expires_at": null,
      "created_at": "2026-11-15T03:24:30.000Z",
      "updated_at": "2026-11-16T01:00:00.000Z",
      "event": {
        "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
        "title": "Casamento da Ana e do Paulo",
        "starts_at": "2027-08-15T17:00:00.000Z",
        "status": "scheduled"
      }
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 }
}
```

`GET /api/v1/host/invitations` — "Meus convites" — `200`; cada item é o
próprio convite com um resumo público do evento:

```json
{
  "data": [
    {
      "id": "1a80b39f-cb8c-49d2-86ff-cf4de1b74803",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "rsvp_status": "pending",
      "rsvp_responded_at": null,
      "table_name": "Mesa 3",
      "invitation_url": "https://apupu-front.vercel.app/convite/3f9c2a7e5b1d4c8fa6e0",
      "invitation_url_expires_at": null,
      "created_at": "2026-11-01T10:00:00.000Z",
      "event": {
        "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
        "title": "Casamento da Ana e do João",
        "host_name": "Ana Silva",
        "starts_at": "2026-12-01T17:00:00.000Z",
        "timezone": "Africa/Luanda",
        "status": "scheduled",
        "category": "wedding",
        "template_id": "aurora",
        "location": {
          "type": "venue",
          "name": "Salão X",
          "address": "Luanda",
          "online_url": null
        }
      }
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 }
}
```

Regras de "Meus convites":

- Associação **opção A**: `invitations.guest_email` = `hosts.email` da
  conta autenticada, comparado sem distinguir maiúsculas/minúsculas. Não
  há ligação explícita convite↔conta nem migração.
- Só a conta com o email verificado vê a lista; antes disso a resposta é
  `403 email_not_verified`. Isto impede que alguém registe o email de
  outra pessoa e reclame convites alheios.
- Um convite criado antes de a conta existir aparece automaticamente
  assim que a conta com esse email estiver verificada.
- Se a conta mudar de email, os convites antigos deixam de aparecer: a
  associação segue sempre o email **atual** da conta. Voltar ao email
  anterior faz reaparecer os convites.
- Convites revogados não aparecem (`claim_revoked_at IS NOT NULL`).
- Eventos `cancelled`/`completed` continuam a aparecer com o respectivo
  `event.status`.
- Lista vazia devolve `200` com `data: []` e paginação a zeros.
- Ordenação por omissão: `starts_at asc` (próximos primeiro), com
  `NULLS LAST`; desempate por `id`. `order=desc` inverte.
- Não expõe outros convidados, contagens, email/telefone de convidados,
  contribuições/banca, notas privadas, `host_email`, `message`, `rules`
  nem estatísticas.
- `invitation_url` é o mesmo link do email, apontando para
  `<APP_BASE_URL>/convite/<token>`; o convidado pode abri-lo. Não expira
  nesta fase (`invitation_url_expires_at` é `null`).

`GET /api/v1/host/activity` — `200`; inclui `event_title`:

```json
{
  "data": [
    {
      "id": "9b1f1d0e-6a0c-4a52-9d4d-2f7e3f3a1b10",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "kind": "rsvp_accepted",
      "guest_name": "João",
      "at": "2026-11-16T01:00:00.000Z",
      "event_title": "Casamento da Ana e do Paulo"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 }
}
```

`GET /api/v1/host/events/{eventId}/activity` — `200`; mesma forma, sem
`event_title`:

```json
{
  "data": [
    {
      "id": "9b1f1d0e-6a0c-4a52-9d4d-2f7e3f3a1b10",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "kind": "rsvp_accepted",
      "guest_name": "João",
      "at": "2026-11-16T01:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 }
}
```

`GET /api/v1/host/reports/summary` — `200`:

```json
{
  "data": {
    "events": [
      {
        "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
        "title": "Casamento da Ana e do Paulo",
        "status": "scheduled",
        "total_invitations": 10,
        "accepted": 4,
        "declined": 2,
        "pending": 4
      }
    ],
    "totals": {
      "total_invitations": 10,
      "accepted": 4,
      "declined": 2,
      "pending": 4,
      "response_rate": 0.6,
      "acceptance_rate": 0.4
    }
  }
}
```

- `response_rate` = `(accepted + declined) / total_invitations`.
- `acceptance_rate` = `accepted / total_invitations`.
- Ambos são fracções entre `0` e `1`, arredondadas a 4 casas; `0`
  quando não há convites.

`GET /api/v1/host/events/{eventId}/reports?days=30` — `200`:

```json
{
  "data": {
    "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
    "days": 30,
    "series": [
      {
        "date": "2026-11-16",
        "invitations": 3,
        "accepted": 1,
        "declined": 0,
        "reminders": 0
      }
    ]
  }
}
```

- `series` tem exactamente `days` pontos, em dias UTC, incluindo dias
  sem movimento.
- `date` é `YYYY-MM-DD`.

`GET /api/v1/host/reports/export?format=pdf|csv` — `200`:

- Devolve o ficheiro directamente (`Content-Disposition: attachment`),
  não o envelope JSON.
- `pdf`: `application/pdf`, gerado no servidor com a identidade visual
  do Conto Contigo, cabeçalho e rodapé em todas as páginas e o gráfico
  circular das respostas.
- `csv`: `text/csv; charset=utf-8`, com BOM para o Excel, separador
  `;` e linhas CRLF. Células que começam por `=`, `+`, `-` ou `@` são
  prefixadas com `'` para não serem interpretadas como fórmulas.
- Nome do ficheiro: `conto-contigo_relatorio_YYYY-MM-DD.{pdf,csv}`.
- `format` inválido devolve `422 validation_failed`.

`GET /api/v1/host/events/{eventId}/exports/{document}?format=pdf|csv` —
`200`:

- `document` aceita:
  - `guests` — lista completa de convidados e respostas;
  - `summary` — resumo do evento com o gráfico circular;
  - `attendance` — presenças confirmadas (não existe check-in);
  - `ticket` — bilhete individual com QR, só em PDF, e exige
    `invitation_id`.
- O acesso é validado pela conta autenticada; eventos de outra conta
  devolvem `404 event_not_found`.
- `pdf`: A4 vertical, Figtree embebida, tabelas com cabeçalho repetido
  e marca de água do símbolo. Os valores usam `12 500,00 Kz` e as datas
  `22 nov 2026, 15:00` em `Africa/Luanda`.
- `csv`: UTF-8 com BOM, separador `;`, CRLF, cabeçalhos em pt-PT e
  datas `YYYY-MM-DD HH:mm` em `Africa/Luanda`. Telemóveis são texto no
  formato `+244 9XX XXX XXX`; números não têm separador de milhares e
  usam vírgula decimal.
- Nome do ficheiro:
  `conto-contigo_{tipo}_{slug-do-evento}_{YYYY-MM-DD}.{pdf,csv}`,
  onde `tipo` é `convidados`, `resumo`, `presencas` ou `bilhete`.
- `ticket` com `format=csv` devolve `400 bad_request`; `ticket` sem
  `invitation_id` devolve `400 bad_request` com `fields`.

`GET /api/v1/host/managers` — `200`:

```json
{
  "data": [
    {
      "id": "b2d5f4a1-3c47-4a3e-9c2d-1f2a3b4c5d6e",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "email": "paulo@exemplo.ao",
      "has_account": true,
      "last_used_at": "2026-11-16T09:00:00.000Z",
      "created_at": "2026-11-10T08:00:00.000Z",
      "updated_at": "2026-11-10T08:00:00.000Z",
      "event": {
        "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
        "title": "Casamento da Ana e do Paulo",
        "starts_at": "2026-12-20T15:00:00.000Z",
        "status": "scheduled"
      }
    }
  ]
}
```

- A lista global só inclui eventos cujo `host_id` é o da conta; eventos
  em que a conta é apenas gestora não expõem a equipa.
- Adicionar, reenviar e remover continuam a usar as rotas por evento.

`GET /api/v1/host/tasks` — `200`, paginado:

```json
{
  "data": [
    {
      "id": "0f0e5f6a-9b1c-4d3e-8a2b-7c6d5e4f3a21",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "event_title": "Casamento da Ana e do Paulo",
      "manager_id": "b2d5f4a1-3c47-4a3e-9c2d-1f2a3b4c5d6e",
      "manager_email": "paulo@exemplo.ao",
      "label": "Confirmar menu",
      "done": false,
      "completed_at": null,
      "created_at": "2026-11-16T01:00:00.000Z",
      "updated_at": "2026-11-16T01:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 }
}
```

- `event_id` é `null` para tarefas globais da conta.
- `manager_id`/`manager_email` são `null` nas tarefas do próprio
  anfitrião; quando preenchidos, a tarefa foi atribuída a esse gestor.
- Só o anfitrião cria tarefas. `POST /api/v1/host/tasks`
  (`{ "label": "...", "event_id": null, "manager_id": null }`) devolve
  `201 { "data": Task }`. Atribuir a um gestor exige `event_id` e um
  gestor activo desse evento; caso contrário `422 validation_failed`.
- `PATCH /api/v1/host/tasks/{taskId}` aceita `label` e/ou `done` e
  devolve `200 { "data": Task }`. Um gestor só pode alternar `done` nas
  tarefas que lhe foram atribuídas; tentar alterar `label` devolve
  `403 host_action_forbidden`.
- `DELETE /api/v1/host/tasks/{taskId}` devolve `204` e está reservado ao
  anfitrião.
- Ao atribuir uma tarefa, o gestor recebe a notificação `task_assigned`;
  ao concluí-la, o anfitrião recebe `task_completed`.

#### Capa do evento

A imagem de capa pode ser definida por URL ou por upload. Ambas as
operações são idempotentes: repetir o mesmo URL ou o mesmo ficheiro
(comparado por SHA-256) não volta a gravar nem a enviar para o
Cloudinary. O evento devolvido inclui `cover_url`.

- `PUT /api/v1/host/events/{eventId}/cover` — corpo
  `{ "cover_url": "https://..." }` (URL `https` válido), resposta
  `200 { "data": Event }`.
- `POST /api/v1/host/events/{eventId}/cover/upload` —
  `multipart/form-data` com o campo `cover` (imagem até
  `EVENT_COVER_MAX_BYTES`, por omissão 8 MiB), resposta
  `200 { "data": Event }`. Sem credenciais Cloudinary devolve
  `503 event_cover_upload_unavailable`.
- `DELETE /api/v1/host/events/{eventId}/cover` — resposta
  `200 { "data": Event }` com `cover_url: null`; repetir é inofensivo.

Todas exigem `X-CSRF-Token` e devolvem `404 event_not_found` quando o
evento não é acessível à conta.

#### Actividade

`GET /api/v1/host/activity` e
`GET /api/v1/host/events/{eventId}/activity` são paginados.

`DELETE /api/v1/host/events/{eventId}/activity/{activityId}` — `204`.
Apenas o anfitrião, e apenas na área de gestão do evento, pode eliminar
uma actividade; a notificação associada é removida. Um gestor recebe
`403 host_action_forbidden`; uma actividade inexistente devolve
`404 activity_not_found`.

#### Notificações

As notificações são uma camada persistida (`host_notifications`) por
anfitrião, gerada a partir de actividades e lembretes. O feed nunca
altera `event_activity`.

`GET /api/v1/host/notifications` — `200`:

```json
{
  "data": [
    {
      "id": "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98",
      "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
      "event_title": "Casamento da Ana e do Paulo",
      "activity_id": "9b1f1d0e-6a0c-4a52-9d4d-2f7e3f3a1b10",
      "kind": "rsvp_accepted",
      "title": "João aceitou o convite",
      "body": null,
      "metadata": { "invitation_id": "..." },
      "read": false,
      "read_at": null,
      "created_at": "2026-11-16T01:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1 },
  "unread_count": 1
}
```

- `kind`: `rsvp_accepted`, `rsvp_declined`, `guest_added`,
  `reminder_sent`, `event_created`, `event_upcoming`, `rsvp_deadline`,
  `task_assigned`, `task_completed`.
- `GET /api/v1/host/notifications/unread-count` — `200`
  `{ "data": { "unread_count": 3 } }`.
- `PATCH /api/v1/host/notifications/{notificationId}` — corpo
  `{ "read": true }`, resposta `200 { "data": Notification }`;
  `404 notification_not_found` se não existir.
- `DELETE /api/v1/host/notifications/{notificationId}` — `204`.
- `POST /api/v1/host/notifications/read-all` — `200`
  `{ "data": { "updated": 3 } }`.
- `DELETE /api/v1/host/notifications` — `200`
  `{ "data": { "removed": 3 } }` (remoção lógica).
- Os lembretes (`event_upcoming`, `rsvp_deadline`) são derivados no
  momento da leitura e deduplicados, pelo que a operação é idempotente.

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
    "manage_email_status": "queued",
    "deliveries": [
      { "email": "joao@exemplo.ao", "status": "queued" }
    ]
  }
}
```

O segredo de gestão **não** é devolvido: é enviado uma única vez para
`host_email` no link de gestão. O link é enfileirado na outbox e o
pedido responde imediatamente com `manage_email_status: queued`; uma
falha ao enfileirar devolve `failed`. A entrega real acontece em segundo
plano. Os convites seguem o mesmo modelo e são reportados como `queued`
(consultar `send_status` no convite para o estado final).

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
    "role": "host",
    "access_role": "host",
    "email": "ana@exemplo.ao",
    "email_has_account": true,
    "csrf_token": "<valor para X-CSRF-Token>",
    "expires_at": "2026-11-16T03:38:46.344Z",
    "manage_email_status": "queued",
    "manage_token_expires_at": "2026-12-16T01:38:46.345Z"
  }
}
```

O mesmo endpoint aceita o segredo de um link de gestor:

- `role`/`access_role` valem `host` para o link do anfitrião e
  `manager` para o link de um gestor.
- `email` é o email associado ao link (do anfitrião ou do gestor) e
  `email_has_account` indica se esse email já tem conta registada. O
  frontend usa estes campos para sugerir entrar ou criar conta.
- Sessões de gestor devolvem `manage_email_status: null`: o link do
  gestor **não roda** ao ser usado. O link do anfitrião roda, como
  descrito abaixo.
- A área de gestão por link continua disponível para gestores sem conta
  e permite editar as informações do evento, mas esconde as ações
  reservadas ao anfitrião.

Para o link do anfitrião:

- A troca **rota** o link: o token usado deixa imediatamente de ser
  válido e um novo link é enviado para `host_email`. Repetir o mesmo
  token devolve `404 manage_link_invalid`.
- O token em claro nunca é devolvido em JSON. `manage_email_status`
  (`queued` | `failed`) indica se o novo link ficou na outbox; o envio
  acontece em segundo plano.
- `manage_token_expires_at` é o fim da validade do novo link (30 dias
  por omissão, `MANAGE_TOKEN_TTL_DAYS`).
- A rotação é atómica: a sessão é criada e o token é substituído na
  mesma transacção.

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

- Um gestor pode editar as informações do evento (título, datas,
  local, mensagem, tema, contribuição, etc.).
- `status` e `host_email` continuam reservados ao anfitrião. Um gestor
  que os envie recebe `403 host_action_forbidden`.
- Alterar `starts_at` ou `timezone` cancela e reconstrói os lembretes
  futuros ainda não enviados.
- `status=draft` suspende convites e lembretes pendentes; voltar a
  `scheduled` reagenda os lembretes futuros.
- `status=cancelled` cancela convites/lembretes pendentes e enfileira o
  aviso de cancelamento aos convidados que não recusaram.
- `status=completed` cancela convites/lembretes pendentes.
- `theme` e `contribution` são fundidos com o estado actual.

### 4. Gerir convidados

As rotas do evento aceitam a sessão de gestão legada (do anfitrião ou
de um gestor) ou a sessão de conta com acesso ao evento. Com sessão de
conta, não é necessário enviar/trocar o token secreto de gestão; as
mutações continuam a exigir `X-CSRF-Token`.

| Método | Rota | Efeito | Gestor |
|---|---|---|---|
| `GET` | `/api/v1/host/events/{eventId}/invitations` | Lista privada | sim |
| `POST` | `/api/v1/host/events/{eventId}/invitations` | Adiciona e enfileira convite | sim |
| `PATCH` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | Actualiza dados | não |
| `DELETE` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | Remove convite e entregas | não |
| `POST` | `.../{invitationId}/resend` | Reenvia o link individual | não |
| `POST` | `.../{invitationId}/revoke` | Revoga o acesso do navegador | não |

Um gestor pode consultar a lista e adicionar convidados, mas não pode
alterar, remover, reenviar nem revogar convites existentes. Essas ações
devolvem `403 host_action_forbidden` quando a sessão é de gestor.

Payload de criação/actualização:

```json
{ "name": "João", "email": "joao@exemplo.ao", "phone": "+244900000000", "table_name": "Mesa 1" }
```

O `PATCH` só é permitido ao anfitrião. Enquanto o convidado não abriu o
link (`opened_at: null`), o anfitrião pode corrigir `email` e `phone`.
Depois da primeira abertura, alterações a esses dois campos são rejeitadas
com `409 invitation_already_opened`; `name` e `table_name` continuam
editáveis.

Ao alterar o email, o convite roda o token do link, cancela mensagens
pendentes, envia um aviso `invitation_removed` ao email antigo e volta a
enviar o convite e os lembretes ao novo email. Remover o convite ou
revogar o acesso também enfileira o aviso ao destinatário actual. O aviso
é entregue mesmo que o convite já tenha sido apagado: fica registado em
`email_deliveries` com `invitation_id = NULL` e `message_type =
invitation_removed`.

Só é possível adicionar convidados a um evento `scheduled`. O limite é
`MAX_INVITATIONS_PER_EVENT`. O email do próprio anfitrião não pode ser
usado como convidado: a criação do evento falha com `422 validation_failed`
em `guests.{index}.email`, e adicionar ou alterar um convite devolve
`409 invitation_host_email`. Todas as rotas mutáveis exigem
`X-CSRF-Token`.

## Fluxo do convidado

### Reclamar o convite

`POST /api/v1/public/invitations/{token}/claim`

- O primeiro claim válido é atómico e emite a capacidade do navegador.
- Token inválido ou convite revogado devolvem sempre o mesmo `404`
  genérico (`invitation_not_found`).
- O mesmo navegador pode reabrir o convite e reclamar convites
  adicionais com a mesma capacidade.
- Se o pedido trouxer uma sessão de conta (`apupu_auth`) cujo email
  verificado coincide com o email do convite, o convite é devolvido
  mesmo que já tenha sido reclamado noutro navegador. Nesse caso o
  `claim_hash` existente **não** é alterado: os dois acessos coexistem.

Resposta `200`:

```json
{
  "data": {
    "event": { "id": "...", "title": "...", "starts_at": "...", "timezone": "Africa/Luanda" },
    "guest": {
      "name": "João",
      "email": "joao@exemplo.ao",
      "email_has_account": true,
      "rsvp_status": "pending",
      "rsvp_responded_at": null
    },
    "rsvp_deadline_passed": false,
    "csrf_token": "<valor para X-CSRF-Token>"
  }
}
```

### Consultar o convite

`GET /api/v1/public/invitations/{token}` — aceita a capacidade do
navegador **ou** uma sessão de conta cujo email verificado coincide com
o email do convite. Devolve a mesma apresentação pública, sem telefone
nem dados de outros convidados. A resposta inclui o email do próprio
convidado e `email_has_account` para o frontend sugerir conta.

### Responder

`PUT /api/v1/public/invitations/{token}/rsvp`

```json
{ "status": "accepted" }
```

- `status`: `accepted` | `declined`.
- Exige a capacidade do navegador ou a sessão de conta correspondente,
  mais `X-CSRF-Token` derivado desse segredo.
- Repetir o mesmo estado é idempotente.
- `declined` cancela os lembretes futuros do convite e notifica o
  anfitrião por email.
- Voltar de `declined` para `accepted` reagenda os lembretes futuros.
- `409` se o evento estiver cancelado/terminado ou o prazo tiver
  passado.

## Modelos de resposta

Tipos reutilizados nas respostas. Todos os objectos são JSON e os
campos opcionais só aparecem quando têm valor, salvo indicação em
contrário.

### `Pagination`

```json
{ "page": 1, "page_size": 20, "total": 42, "total_pages": 3 }
```

| Campo | Tipo | Notas |
|---|---|---|
| `page` | inteiro | Começa em 1 |
| `page_size` | inteiro | 1 a 100 |
| `total` | inteiro | Total de registos |
| `total_pages` | inteiro | `ceil(total / page_size)`; `0` sem registos |

### `Host`

```json
{
  "id": "584476e6-c785-4440-9f58-06ccc006efd1",
  "email": "ana@exemplo.ao",
  "email_verified": true,
  "status": "active",
  "profile": {
    "display_name": "Ana",
    "phone": null,
    "birth_date": "1994-05-20",
    "locale": "pt-AO",
    "timezone": "Africa/Luanda",
    "avatar_url": null,
    "cover_url": null
  },
  "profile_complete": true,
  "missing_fields": [],
  "created_at": "2026-11-15T03:24:13.372Z"
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `email_verified` | booleano | Deriva de `email_verified_at` |
| `status` | string | `active`, `suspended` ou `deleted` |
| `profile.birth_date` | string \| null | `YYYY-MM-DD`; nunca incluído noutros recursos |
| `profile_complete` | booleano | `false` enquanto faltar `birth_date` |
| `missing_fields` | string[] | Actualmente `["birth_date"]` ou `[]` |

### `Event`

```json
{
  "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
  "title": "Casamento da Ana e do Paulo",
  "host_name": "Ana",
  "host_email": "ana@exemplo.ao",
  "category": "wedding",
  "starts_at": "2027-08-15T17:00:00.000Z",
  "ends_at": "2027-08-16T01:00:00.000Z",
  "timezone": "Africa/Luanda",
  "location": {
    "type": "venue",
    "name": "Salão Principal",
    "address": "Luanda",
    "online_url": null
  },
  "message": "Celebramos o nosso casamento.",
  "rules": "Traje formal.",
  "dress_code": "Traje formal",
  "template_id": null,
  "cover_url": "https://res.cloudinary.com/demo/image/upload/capa.jpg",
  "theme": { "mode": "dark", "palette": "default" },
  "contribution": { "enabled": false },
  "rsvp_deadline": "2027-08-01T22:59:59.000Z",
  "status": "scheduled",
  "access_role": "host",
  "created_at": "2026-11-16T01:40:07.999Z",
  "updated_at": "2026-11-16T01:40:07.999Z",
  "stats": {
    "total_invitations": 10,
    "accepted": 4,
    "declined": 2,
    "pending": 4
  }
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `category` | string \| null | `wedding`, `birthday`, `corporate`, `baby`, `other` |
| `starts_at` / `ends_at` | string \| null | ISO 8601 UTC |
| `location.type` | string | `venue` ou `online` |
| `contribution` | object | Com `enabled=false` só este campo é devolvido |
| `status` | string | `draft`, `scheduled`, `cancelled`, `completed` |
| `access_role` | string | `host` ou `manager`; presente nas vistas de gestão e na sessão |
| `cover_url` | string \| null | Imagem de capa (upload ou URL); `null` usa a arte do template |
| `stats` | object | Só nas listas de gestão, `dashboard` e detalhe por sessão de evento |

A vista pública (`PublicEvent`) omite `host_email`, `template_id`,
`created_at`, `updated_at`, `stats` e `access_role`.

### `Invitation`

```json
{
  "id": "1a80b39f-cb8c-49d2-86ff-cf4de1b74803",
  "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
  "guest_name": "João",
  "guest_email": "joao@exemplo.ao",
  "guest_phone": "+244900000000",
  "table_name": "Mesa 1",
  "rsvp_status": "pending",
  "rsvp_responded_at": null,
  "send_status": "queued",
  "send_count": 1,
  "last_sent_at": null,
  "opened_at": null,
  "invitation_url": "https://apupu-front.vercel.app/convite/3f9c2a7e5b1d4c8fa6e0",
  "invitation_url_expires_at": null,
  "created_at": "2026-11-15T03:24:30.000Z",
  "updated_at": "2026-11-15T03:24:30.000Z"
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `rsvp_status` | string | `pending`, `accepted`, `declined` |
| `send_status` | string | `pending`, `queued`, `sent`, `failed` |
| `send_count` | inteiro | Número de envios |
| `opened_at` | string \| null | Primeira vez que o convidado abriu o link; `null` enquanto nunca foi aberto |
| `table_name` | string \| null | Visível apenas ao anfitrião |
| `invitation_url` | string \| null | URL absoluto para o anfitrião partilhar (WhatsApp, etc.); `null` quando o convite foi revogado. Só existe nas respostas de gestão |
| `invitation_url_expires_at` | string \| null | Hoje é sempre `null`: o link não expira e só é invalidado pela revogação |

Semântica do link de partilha:

- É o **mesmo token** enviado no email do convite e aponta para
  `<APP_BASE_URL>/convite/<token>` (nunca para a API diretamente).
- Não expira e não é de uso único. O primeiro navegador que o abre
  reivindica o convite (cookie `apupu_guest`); a partir daí, outro
  navegador sem esse cookie recebe `404 invitation_not_found`.
- O anfitrião deve partilhar o URL, **não** o abrir: ao abri-lo, o
  próprio navegador do anfitrião passa a ser o reclamante.
- `POST .../invitations/{id}/resend` mantém o mesmo token/link.
- `POST .../invitations/{id}/revoke` invalida o link para sempre; a
  resposta seguinte devolve `invitation_url: null`.
- `GET /host/guests`, `GET /host/invitations` e
  `GET /host/events/{eventId}/invitations` (e o detalhe do evento)
  incluem o campo; as respostas públicas (`/public/invitations/*`)
  nunca o incluem.

### `HostGuest`

`Invitation` + `event`:

```json
{
  "...": "campos de Invitation",
  "event": {
    "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
    "title": "Casamento da Ana e do Paulo",
    "starts_at": "2027-08-15T17:00:00.000Z",
    "status": "scheduled"
  }
}
```

### `GuestInvitation`

Item de "Meus convites" (`GET /api/v1/host/invitations`). Contém apenas
o próprio convite e um resumo público do evento:

```json
{
  "id": "1a80b39f-cb8c-49d2-86ff-cf4de1b74803",
  "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
  "rsvp_status": "pending",
  "rsvp_responded_at": null,
  "table_name": "Mesa 3",
  "invitation_url": "https://apupu-front.vercel.app/convite/3f9c2a7e5b1d4c8fa6e0",
  "invitation_url_expires_at": null,
  "created_at": "2026-11-01T10:00:00.000Z",
  "event": {
    "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
    "title": "Casamento da Ana e do João",
    "host_name": "Ana Silva",
    "starts_at": "2026-12-01T17:00:00.000Z",
    "timezone": "Africa/Luanda",
    "status": "scheduled",
    "category": "wedding",
    "template_id": "aurora",
    "cover_url": "https://res.cloudinary.com/demo/image/upload/capa.jpg",
    "location": {
      "type": "venue",
      "name": "Salão X",
      "address": "Luanda",
      "online_url": null
    }
  }
}
```

Não inclui `guest_name`, `guest_email`, `guest_phone`, `send_status`,
`send_count`, `updated_at`, `host_email`, `contribution`, `message`,
`rules` nem `stats`.

### `Activity`

```json
{
  "id": "9b1f1d0e-6a0c-4a52-9d4d-2f7e3f3a1b10",
  "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
  "kind": "rsvp_accepted",
  "guest_name": "João",
  "at": "2026-11-16T01:00:00.000Z"
}
```

O feed da conta acrescenta `event_title`. `kind` é um identificador
estável do tipo de actividade (por exemplo `rsvp_accepted`,
`rsvp_declined`, `invitation_sent`).

### `Task`

```json
{
  "id": "0f0e5f6a-9b1c-4d3e-8a2b-7c6d5e4f3a21",
  "event_id": null,
  "event_title": null,
  "manager_id": null,
  "manager_email": null,
  "label": "Confirmar menu",
  "done": false,
  "completed_at": null,
  "created_at": "2026-11-16T01:00:00.000Z",
  "updated_at": "2026-11-16T01:00:00.000Z"
}
```

`event_title`, `manager_id` e `manager_email` são `null` quando não se
aplicam. `completed_at` é preenchido quando `done=true` e limpo ao
reabrir a tarefa.

### `Notification`

```json
{
  "id": "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98",
  "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
  "event_title": "Casamento da Ana e do Paulo",
  "activity_id": "9b1f1d0e-6a0c-4a52-9d4d-2f7e3f3a1b10",
  "kind": "rsvp_accepted",
  "title": "João aceitou o convite",
  "body": null,
  "metadata": {},
  "read": false,
  "read_at": null,
  "created_at": "2026-11-16T01:00:00.000Z"
}
```

### `EventManager`

```json
{
  "id": "b2d5f4a1-3c47-4a3e-9c2d-1f2a3b4c5d6e",
  "event_id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
  "email": "paulo@exemplo.ao",
  "has_account": false,
  "last_used_at": null,
  "created_at": "2026-11-16T01:40:07.999Z",
  "updated_at": "2026-11-16T01:40:07.999Z"
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `email` | string | normalizado para minúsculas |
| `has_account` | boolean | existe conta verificada com o mesmo email |
| `last_used_at` | string \| null | último uso do link do gestor |

O token do link nunca é devolvido.

### `PublicInvitation`

```json
{
  "event": {
    "id": "2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec",
    "title": "Casamento da Ana e do Paulo",
    "host_name": "Ana",
    "category": "wedding",
    "starts_at": "2027-08-15T17:00:00.000Z",
    "ends_at": "2027-08-16T01:00:00.000Z",
    "timezone": "Africa/Luanda",
    "location": {
      "type": "venue",
      "name": "Salão Principal",
      "address": "Luanda",
      "online_url": null
    },
    "message": "Celebramos o nosso casamento.",
    "rules": "Traje formal.",
    "dress_code": "Traje formal",
    "theme": { "mode": "dark", "palette": "default" },
    "contribution": { "enabled": false },
    "rsvp_deadline": "2027-08-01T22:59:59.000Z",
    "status": "scheduled"
  },
  "guest": {
    "name": "João",
    "email": "joao@exemplo.ao",
    "email_has_account": true,
    "rsvp_status": "pending",
    "rsvp_responded_at": null
  },
  "rsvp_deadline_passed": false,
  "csrf_token": "<valor para X-CSRF-Token>"
}
```

Inclui apenas os dados do próprio convidado. Nunca inclui
`guest_phone`, `table_name` nem dados de outros convidados.
`email_has_account` permite ao frontend sugerir entrar ou criar conta
para abrir o convite em qualquer navegador.

### `ReportSummary` e `DailyReport`

```json
{
  "events": [
    {
      "event_id": "...",
      "title": "...",
      "status": "scheduled",
      "total_invitations": 10,
      "accepted": 4,
      "declined": 2,
      "pending": 4
    }
  ],
  "totals": {
    "total_invitations": 10,
    "accepted": 4,
    "declined": 2,
    "pending": 4,
    "response_rate": 0.6,
    "acceptance_rate": 0.4
  }
}
```

```json
{
  "date": "2026-11-16",
  "invitations": 3,
  "accepted": 1,
  "declined": 0,
  "reminders": 0
}
```

### Erros

Todos os erros usam o envelope `error` descrito em
[Convenções](#convenções). `fields` só aparece em `422` de validação e
`request_id` aparece sempre.

## Templates

`GET /api/v1/templates` — lista apenas templates activos, com os campos
e temas suportados. Uma lista vazia é válida. Os templates visuais finais
serão fornecidos pelo responsável do produto.

Resposta `200`:

```json
{
  "data": [
    {
      "id": "3f2c1d0e-8b7a-4c6d-9e5f-1a2b3c4d5e6f",
      "slug": "base",
      "name": "Base",
      "description": "Template neutro.",
      "preview_image_url": null,
      "supported_fields": ["title", "message", "location"],
      "themes": [{ "mode": "light", "palette": "default" }],
      "is_active": true
    }
  ]
}
```

## Rate limit

Todos os ambientes aplicam `/api/v1`:

- Global: `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`.
- Endpoints públicos com token: `PUBLIC_RATE_LIMIT_WINDOW_MS` /
  `PUBLIC_RATE_LIMIT_MAX`.
- Troca do segredo de gestão: `HOST_SESSION_RATE_LIMIT_WINDOW_MS` /
  `HOST_SESSION_RATE_LIMIT_MAX`.
- Autenticação (`register`, `register/request-code`,
  `register/verify-code`, `login`, `email/verify/resend`,
  `password/forgot`): `AUTH_RATE_LIMIT_WINDOW_MS` /
  `AUTH_RATE_LIMIT_MAX`, aplicado por IP e por IP + email.
- Escritas de gestão (criar/actualizar/apagar eventos, convidados,
  tarefas, perfil, avatar, reenvio de link de gestão e reenvio de
  convite): `WRITE_RATE_LIMIT_WINDOW_MS` /
  `WRITE_RATE_LIMIT_MAX`.
- RSVP público: `RSVP_RATE_LIMIT_WINDOW_MS` /
  `RSVP_RATE_LIMIT_MAX`, aplicado por IP + token do convite.
- Verificação de email, verificação de código OTP e reposição de senha
  consomem também o limite público de tokens.

O limite de escritas escolhe a chave mais específica disponível:
conta autenticada → evento → convite → IP. O limite de RSVP usa sempre
IP + token, para que um convite não possa ser usado para esgotar o
limite de outro.

Os cabeçalhos `RateLimit-Policy`, `RateLimit-Limit`,
`RateLimit-Remaining` e `RateLimit-Reset` acompanham as respostas
limitadas. Ao exceder, a resposta é `429` com `error.code =
"rate_limited"`; nenhum limite interno é revelado no corpo.

`/health` fica fora do limite global para não afectar orquestradores.

## Mapa de respostas por endpoint

Resumo do corpo de sucesso de cada rota. `—` significa `204` sem
corpo. Todas as rotas podem devolver os erros transversais de
[Códigos de erro](#códigos-de-erro).

### Autenticação

| Método | Rota | Sucesso | Corpo |
|---|---|---|---|
| `POST` | `/api/v1/auth/register/request-code` | `202` `{ "data": { "status": "accepted", "email": string, "expires_at": string, "resend_available_at": string } }`; `200` `{ "data": { "status": "guest_verified", "email": string, "display_name": string \| null, "verification_token": string, "expires_at": string } }` |
| `POST` | `/api/v1/auth/register/verify-code` | `200` | `{ "data": { "email": string, "verification_token": string, "expires_at": string } }` |
| `POST` | `/api/v1/auth/register` | `201` | `{ "data": { "host": Host, "csrf_token": string, "expires_at": string } }` |
| `POST` | `/api/v1/auth/email/verify` | `200` | `{ "data": { "host": Host } }` |
| `POST` | `/api/v1/auth/email/verify/resend` | `202` | `{ "data": { "status": "accepted" } }` |
| `POST` | `/api/v1/auth/login` | `200` | `{ "data": { "host": Host, "csrf_token": string, "expires_at": string } }` |
| `POST` | `/api/v1/auth/logout` | `204` | — |
| `GET` | `/api/v1/auth/session` | `200` | `{ "data": { "host": Host, "csrf_token": string } }` |
| `POST` | `/api/v1/auth/password/forgot` | `202` | `{ "data": { "status": "accepted" } }` |
| `POST` | `/api/v1/auth/password/reset` | `204` | — |
| `POST` | `/api/v1/auth/password/change` | `204` | — |

### Perfil e workspace

| Método | Rota | Sucesso | Corpo |
|---|---|---|---|
| `GET` | `/api/v1/host/profile` | `200` | `{ "data": { "host": Host } }` |
| `PATCH` | `/api/v1/host/profile` | `200` | `{ "data": { "host": Host } }` |
| `POST` | `/api/v1/host/profile/avatar` | `200` | `{ "data": { "host": Host } }` |
| `POST` | `/api/v1/host/profile/avatar/upload` | `200` | `{ "data": { "host": Host } }` |
| `POST` | `/api/v1/host/profile/cover` | `200` | `{ "data": { "host": Host } }` |
| `POST` | `/api/v1/host/profile/cover/upload` | `200` | `{ "data": { "host": Host } }` |
| `DELETE` | `/api/v1/host/profile/cover` | `200` | `{ "data": { "host": Host } }` |
| `GET` | `/api/v1/host/events` | `200` | `{ "data": Event[], "pagination": Pagination }` |
| `POST` | `/api/v1/host/events` | `201` | `{ "data": { "event": Event, "manage_email_status": "queued" \| "failed", "deliveries": [{ "email": string, "status": "queued" }] } }` |
| `DELETE` | `/api/v1/host/events/{eventId}` | `204` | — |
| `POST` | `/api/v1/host/events/{eventId}/manage-link/resend` | `202` | `{ "data": { "event_id": uuid, "manage_email_status": "queued" \| "failed", "manage_token_expires_at": string \| null } }` |
| `GET` | `/api/v1/host/events/{eventId}/managers` | `200` | `{ "data": EventManager[] }` |
| `GET` | `/api/v1/host/managers` | `200` | `{ "data": HostEventManager[] }` |
| `POST` | `/api/v1/host/events/{eventId}/managers` | `201` | `{ "data": { "manager": EventManager, "invite_email_status": "queued" \| "failed" } }` |
| `DELETE` | `/api/v1/host/events/{eventId}/managers/{managerId}` | `204` | — |
| `POST` | `/api/v1/host/events/{eventId}/managers/{managerId}/resend` | `202` | `{ "data": { "manager": EventManager, "invite_email_status": "queued" \| "failed" } }` |
| `GET` | `/api/v1/host/dashboard` | `200` | `{ "data": { "next_event": Event \| null, "upcoming": Event[], "totals": Totals } }` |
| `GET` | `/api/v1/host/guests` | `200` | `{ "data": HostGuest[], "pagination": Pagination }` |
| `GET` | `/api/v1/host/invitations` | `200` | `{ "data": GuestInvitation[], "pagination": Pagination }` |
| `GET` | `/api/v1/host/activity` | `200` | `{ "data": ActivityWithEvent[], "pagination": Pagination }` |
| `GET` | `/api/v1/host/events/{eventId}/activity` | `200` | `{ "data": Activity[], "pagination": Pagination }` |
| `DELETE` | `/api/v1/host/events/{eventId}/activity/{activityId}` | `204` | — |
| `PUT` | `/api/v1/host/events/{eventId}/cover` | `200` | `{ "data": Event }` |
| `POST` | `/api/v1/host/events/{eventId}/cover/upload` | `200` | `{ "data": Event }` |
| `DELETE` | `/api/v1/host/events/{eventId}/cover` | `200` | `{ "data": Event }` |
| `GET` | `/api/v1/host/notifications` | `200` | `{ "data": Notification[], "pagination": Pagination, "unread_count": integer }` |
| `GET` | `/api/v1/host/notifications/unread-count` | `200` | `{ "data": { "unread_count": integer } }` |
| `PATCH` | `/api/v1/host/notifications/{notificationId}` | `200` | `{ "data": Notification }` |
| `DELETE` | `/api/v1/host/notifications/{notificationId}` | `204` | — |
| `POST` | `/api/v1/host/notifications/read-all` | `200` | `{ "data": { "updated": integer } }` |
| `DELETE` | `/api/v1/host/notifications` | `200` | `{ "data": { "removed": integer } }` |
| `GET` | `/api/v1/host/reports/summary` | `200` | `{ "data": ReportSummary }` |
| `GET` | `/api/v1/host/reports/export` | `200` | PDF (`application/pdf`) ou CSV (`text/csv`) como anexo |
| `GET` | `/api/v1/host/events/{eventId}/exports/{document}` | `200` | PDF (`application/pdf`) ou CSV (`text/csv`) como anexo |
| `GET` | `/api/v1/host/events/{eventId}/reports` | `200` | `{ "data": { "event_id": uuid, "days": integer, "series": DailyReport[] } }` |
| `GET` | `/api/v1/host/tasks` | `200` | `{ "data": Task[], "pagination": Pagination }` |
| `POST` | `/api/v1/host/tasks` | `201` | `{ "data": Task }` |
| `PATCH` | `/api/v1/host/tasks/{taskId}` | `200` | `{ "data": Task }` |
| `DELETE` | `/api/v1/host/tasks/{taskId}` | `204` | — |

`Totals` = `{ events, drafts, scheduled, cancelled, completed,
total_invitations, accepted, declined, pending }`, todos inteiros.

`EventManager` = `{ id, event_id, email, has_account, last_used_at,
created_at, updated_at }`.

### Fluxo legado por link secreto

| Método | Rota | Sucesso | Corpo |
|---|---|---|---|
| `POST` | `/api/v1/events` | `201` | `{ "data": { "event": Event, "manage_email_status": "queued" \| "failed", "deliveries": [{ "email": string, "status": "queued" }] } }` |
| `POST` | `/api/v1/host/session` | `200` | `{ "data": { "event": Event, "role": "host" \| "manager", "access_role": "host" \| "manager", "email": string, "email_has_account": boolean, "csrf_token": string, "expires_at": string, "manage_email_status": "queued" \| "failed" \| null, "manage_token_expires_at": string \| null } }` |
| `DELETE` | `/api/v1/host/session/{eventId}` | `204` | — |
| `GET` | `/api/v1/host/events/{eventId}` | `200` | `{ "data": { "event": Event, "invitations": Invitation[] } }` |
| `PATCH` | `/api/v1/host/events/{eventId}` | `200` | `{ "data": Event }` |
| `GET` | `/api/v1/host/events/{eventId}/invitations` | `200` | `{ "data": Invitation[] }` |
| `POST` | `/api/v1/host/events/{eventId}/invitations` | `201` | `{ "data": Invitation }` |
| `PATCH` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | `200` | `{ "data": Invitation }` |
| `DELETE` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | `204` | — |
| `POST` | `/api/v1/host/events/{eventId}/invitations/{invitationId}/resend` | `202` | `{ "data": { "status": "queued" } }` |
| `POST` | `/api/v1/host/events/{eventId}/invitations/{invitationId}/revoke` | `200` | `{ "data": Invitation }` |

### Convidado público e templates

| Método | Rota | Sucesso | Corpo |
|---|---|---|---|
| `POST` | `/api/v1/public/invitations/{token}/claim` | `200` | `{ "data": PublicInvitation }` |
| `GET` | `/api/v1/public/invitations/{token}` | `200` | `{ "data": PublicInvitation }` |
| `PUT` | `/api/v1/public/invitations/{token}/rsvp` | `200` | `{ "data": PublicInvitation }` |
| `GET` | `/api/v1/templates` | `200` | `{ "data": Template[] }` |

## Respostas de erro por endpoint

Todas as respostas não-2xx usam o mesmo envelope. Abaixo estão os
corpos reutilizáveis e, depois, o mapa de que erros cada rota devolve.
`request_id` é sempre um UUID diferente por pedido.

### Corpos reutilizáveis

`422 validation_failed` — `fields` lista apenas os campos inválidos:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Verifique os campos indicados.",
    "fields": { "email": ["Email inválido."] },
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`400 invalid_json`:

```json
{
  "error": {
    "code": "invalid_json",
    "message": "Corpo da requisição não é um JSON válido.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`401 host_session_invalid`:

```json
{
  "error": {
    "code": "host_session_invalid",
    "message": "Sessão inválida ou expirada.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`401 invalid_credentials`:

```json
{
  "error": {
    "code": "invalid_credentials",
    "message": "Email ou senha inválidos.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`403 csrf_invalid`:

```json
{
  "error": {
    "code": "csrf_invalid",
    "message": "Token CSRF inválido ou ausente.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`403 email_not_verified`:

```json
{
  "error": {
    "code": "email_not_verified",
    "message": "Confirma o teu email antes de gerir eventos.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`404 invitation_not_found`:

```json
{
  "error": {
    "code": "invitation_not_found",
    "message": "Convite não encontrado.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`404 event_not_found`:

```json
{
  "error": {
    "code": "event_not_found",
    "message": "Evento não encontrado.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`404 manage_link_invalid`:

```json
{
  "error": {
    "code": "manage_link_invalid",
    "message": "Link de gestão inválido ou expirado.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`404 task_not_found`:

```json
{
  "error": {
    "code": "task_not_found",
    "message": "Tarefa não encontrada.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`409` — o `code` varia com a regra de negócio:

```json
{
  "error": {
    "code": "event_not_scheduled",
    "message": "O evento ainda não está agendado.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

Valores possíveis: `event_not_scheduled`, `event_cancelled`,
`event_completed`, `rsvp_deadline_passed`, `invitation_email_duplicate`,
`invitation_limit_reached`, `invitation_host_email`,
`invitation_revoked`, `invitation_not_resendable`,
`email_already_registered`.

`422` de token ou OTP — o `code` identifica o passo:

```json
{
  "error": {
    "code": "otp_invalid",
    "message": "Código inválido ou expirado.",
    "fields": { "code": ["Código inválido ou expirado."] },
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

Valores possíveis: `verification_invalid`, `verification_required`,
`otp_invalid`, `otp_attempts_exceeded`, `reset_invalid`.

`423 account_locked`:

```json
{
  "error": {
    "code": "account_locked",
    "message": "Conta temporariamente bloqueada. Tente novamente mais tarde.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`429 rate_limited`:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Demasiados pedidos. Tente novamente mais tarde.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`429 otp_resend_too_soon`:

```json
{
  "error": {
    "code": "otp_resend_too_soon",
    "message": "Aguarda antes de pedir um novo código.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

`500 internal_error` (qualquer rota, em falha inesperada):

```json
{
  "error": {
    "code": "internal_error",
    "message": "Erro interno do servidor.",
    "request_id": "6b1f0a1e-8f6d-4a3e-9c2d-1f2a3b4c5d6e"
  }
}
```

### Mapa de erros por endpoint

| Método | Rota | Erros documentados |
|---|---|---|
| `POST` | `/api/v1/auth/register/request-code` | `409 email_already_registered`; `422 validation_failed`; `429 otp_resend_too_soon`; `429 rate_limited` |
| `POST` | `/api/v1/auth/register/verify-code` | `422 otp_invalid`; `422 otp_attempts_exceeded`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/auth/register` | `409 email_already_registered`; `422 verification_required`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/auth/email/verify` | `422 verification_invalid`; `429 rate_limited` |
| `POST` | `/api/v1/auth/email/verify/resend` | `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/auth/login` | `401 invalid_credentials`; `422 validation_failed`; `423 account_locked`; `429 rate_limited` |
| `POST` | `/api/v1/auth/logout` | `401 host_session_invalid`; `403 csrf_invalid` |
| `GET` | `/api/v1/auth/session` | `401 host_session_invalid` |
| `POST` | `/api/v1/auth/password/forgot` | `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/auth/password/reset` | `422 reset_invalid`; `429 rate_limited` |
| `POST` | `/api/v1/auth/password/change` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed` |
| `POST` | `/api/v1/events` | `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/session` | `404 manage_link_invalid`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/session/{eventId}` | `401 host_session_invalid`; `403 csrf_invalid`; `429 rate_limited` |
| `GET` | `/api/v1/host/events/{eventId}` | `401 host_session_invalid`; `404 event_not_found` |
| `PATCH` | `/api/v1/host/events/{eventId}` | `401 host_session_invalid`; `403 csrf_invalid`; `403 host_action_forbidden`; `404 event_not_found`; `409`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/events/{eventId}` | `401 host_session_invalid`; `403 csrf_invalid`; `404 event_not_found`; `429 rate_limited` |
| `GET` | `/api/v1/host/events/{eventId}/invitations` | `401 host_session_invalid`; `404 event_not_found` |
| `POST` | `/api/v1/host/events/{eventId}/invitations` | `401 host_session_invalid`; `403 csrf_invalid`; `404 event_not_found`; `409 invitation_host_email`; `422 validation_failed`; `429 rate_limited` |
| `PATCH` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | `401 host_session_invalid`; `403 csrf_invalid`; `403 host_action_forbidden`; `404 invitation_not_found`; `409 invitation_email_duplicate`; `409 invitation_already_opened`; `409 invitation_host_email`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/events/{eventId}/invitations/{invitationId}` | `401 host_session_invalid`; `403 csrf_invalid`; `403 host_action_forbidden`; `404 invitation_not_found`; `429 rate_limited` |
| `POST` | `/api/v1/host/events/{eventId}/invitations/{invitationId}/resend` | `401 host_session_invalid`; `403 csrf_invalid`; `403 host_action_forbidden`; `404 invitation_not_found`; `409 invitation_not_resendable`; `429 rate_limited` |
| `POST` | `/api/v1/host/events/{eventId}/invitations/{invitationId}/revoke` | `401 host_session_invalid`; `403 csrf_invalid`; `403 host_action_forbidden`; `404 invitation_not_found`; `429 rate_limited` |
| `GET` | `/api/v1/host/profile` | `401 host_session_invalid` |
| `PATCH` | `/api/v1/host/profile` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/profile/avatar` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/profile/avatar/upload` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed`; `429 rate_limited`; `503 avatar_upload_unavailable` |
| `POST` | `/api/v1/host/profile/cover` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/profile/cover/upload` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed`; `429 rate_limited`; `503 profile_cover_upload_unavailable` |
| `DELETE` | `/api/v1/host/profile/cover` | `401 host_session_invalid`; `403 csrf_invalid`; `429 rate_limited` |
| `GET` | `/api/v1/host/events` | `401 host_session_invalid`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/events` | `401 host_session_invalid`; `403 email_not_verified`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/events/{eventId}/manage-link/resend` | `401 host_session_invalid`; `403 email_not_verified`; `404 event_not_found`; `429 rate_limited` |
| `GET` | `/api/v1/host/events/{eventId}/managers` | `401 host_session_invalid`; `404 event_not_found` |
| `GET` | `/api/v1/host/managers` | `401 host_session_invalid` |
| `POST` | `/api/v1/host/events/{eventId}/managers` | `401 host_session_invalid`; `403 email_not_verified`; `404 event_not_found`; `409 manager_already_exists`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/events/{eventId}/managers/{managerId}` | `401 host_session_invalid`; `403 csrf_invalid`; `404 manager_not_found`; `429 rate_limited` |
| `POST` | `/api/v1/host/events/{eventId}/managers/{managerId}/resend` | `401 host_session_invalid`; `403 csrf_invalid`; `404 manager_not_found`; `429 rate_limited` |
| `GET` | `/api/v1/host/dashboard` | `401 host_session_invalid` |
| `GET` | `/api/v1/host/guests` | `401 host_session_invalid`; `422 validation_failed`; `429 rate_limited` |
| `GET` | `/api/v1/host/invitations` | `401 host_session_invalid`; `403 email_not_verified`; `422 validation_failed`; `429 rate_limited` |
| `GET` | `/api/v1/host/activity` | `401 host_session_invalid`; `422 validation_failed`; `429 rate_limited` |
| `GET` | `/api/v1/host/events/{eventId}/activity` | `401 host_session_invalid`; `404 event_not_found`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/events/{eventId}/activity/{activityId}` | `401 host_session_invalid`; `403 csrf_invalid`; `403 host_action_forbidden`; `404 activity_not_found`; `429 rate_limited` |
| `PUT` | `/api/v1/host/events/{eventId}/cover` | `401 host_session_invalid`; `403 csrf_invalid`; `404 event_not_found`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/events/{eventId}/cover/upload` | `401 host_session_invalid`; `403 csrf_invalid`; `404 event_not_found`; `422 validation_failed`; `429 rate_limited`; `503 event_cover_upload_unavailable` |
| `DELETE` | `/api/v1/host/events/{eventId}/cover` | `401 host_session_invalid`; `403 csrf_invalid`; `404 event_not_found`; `429 rate_limited` |
| `GET` | `/api/v1/host/notifications` | `401 host_session_invalid`; `422 validation_failed`; `429 rate_limited` |
| `GET` | `/api/v1/host/notifications/unread-count` | `401 host_session_invalid` |
| `PATCH` | `/api/v1/host/notifications/{notificationId}` | `401 host_session_invalid`; `403 csrf_invalid`; `404 notification_not_found`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/notifications/{notificationId}` | `401 host_session_invalid`; `403 csrf_invalid`; `404 notification_not_found`; `429 rate_limited` |
| `POST` | `/api/v1/host/notifications/read-all` | `401 host_session_invalid`; `403 csrf_invalid`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/notifications` | `401 host_session_invalid`; `403 csrf_invalid`; `429 rate_limited` |
| `GET` | `/api/v1/host/reports/summary` | `401 host_session_invalid` |
| `GET` | `/api/v1/host/reports/export` | `401 host_session_invalid`; `422 validation_failed` |
| `GET` | `/api/v1/host/events/{eventId}/exports/{document}` | `400 bad_request`; `401 host_session_invalid`; `404 event_not_found`; `422 validation_failed` |
| `GET` | `/api/v1/host/events/{eventId}/reports` | `401 host_session_invalid`; `404 event_not_found`; `422 validation_failed`; `429 rate_limited` |
| `GET` | `/api/v1/host/tasks` | `401 host_session_invalid`; `422 validation_failed`; `429 rate_limited` |
| `POST` | `/api/v1/host/tasks` | `401 host_session_invalid`; `403 csrf_invalid`; `422 validation_failed`; `429 rate_limited` |
| `PATCH` | `/api/v1/host/tasks/{taskId}` | `401 host_session_invalid`; `403 csrf_invalid`; `404 task_not_found`; `422 validation_failed`; `429 rate_limited` |
| `DELETE` | `/api/v1/host/tasks/{taskId}` | `401 host_session_invalid`; `403 csrf_invalid`; `404 task_not_found`; `429 rate_limited` |
| `POST` | `/api/v1/public/invitations/{token}/claim` | `404 invitation_not_found`; `429 rate_limited` |
| `GET` | `/api/v1/public/invitations/{token}` | `404 invitation_not_found`; `429 rate_limited` |
| `PUT` | `/api/v1/public/invitations/{token}/rsvp` | `403 csrf_invalid`; `404 invitation_not_found`; `409`; `422 validation_failed`; `429 rate_limited` |
| `GET` | `/api/v1/templates` | `429 rate_limited` |

Além disso, qualquer rota pode devolver `400 invalid_json` quando o
corpo não é JSON válido e `500 internal_error` em falhas inesperadas.
Uma rota inexistente devolve `404 route_not_found`; um pedido com
origem não permitida pelo CORS devolve `403 forbidden`.

## Auditoria

As acções críticas são registadas numa tabela append-only
(`host_audit_log`) com actor, evento, instante UTC, IP e resultado.
A auditoria é independente do ciclo de vida da conta e do evento:
`host_id` e `event_id` são UUIDs sem chave estrangeira.

Acções registadas nesta fase:

- `login_success`, `login_failure`, `login_locked`;
- `registration_code_requested`, `registration_code_verified`,
  `registration_code_failed`, `registration_completed`;
- `email_verified`;
- `password_changed`, `password_reset`;
- `profile_updated` (inclui avatar);
- `event_created`, `event_deleted`;
- `guest_added`, `guest_updated`, `guest_deleted`,
  `guest_invitation_resent`, `guest_access_revoked`;
- `manage_link_rotated`, `manage_link_resent`;
- `manager_added`, `manager_removed`, `manager_invite_resent`,
  `manager_link_used`;
- `event_cover_updated`, `event_cover_removed`;
- `activity_deleted`.

Regras:

- Nunca são registadas senhas, tokens, `birth_date` ou conteúdo de
  emails; `metadata` contém apenas identificadores e estados.
- Uma falha ao escrever auditoria não bloqueia a operação de negócio;
  é registada no log interno do servidor.
- O IP vem de `req.ip` (respeitando `TRUST_PROXY`); o actor é
  `host_id` quando existe sessão de conta, ou o `host_id` do evento no
  fluxo legado.
- A tabela não é exposta por nenhum endpoint nesta fase.
