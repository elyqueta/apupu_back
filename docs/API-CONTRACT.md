# Contrato da API — v1 (implementação)

Base: `/api/v1`. Este documento descreve o contrato efectivamente
implementado. A especificação autoritária do produto está em
[`../backend/api-contract.md`](../backend/api-contract.md); em caso de
divergência, essa prevalece.

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
- `X-Request-Id` é devolvido em todas as respostas e repetido em
  `error.request_id`.
- As respostas da API usam `Cache-Control: private, no-store`.

## Códigos de erro

| HTTP | `code` | Significado |
|---|---|---|
| `400` | `invalid_json` | Corpo não é JSON válido |
| `401` | `host_session_invalid` | Sessão de gestão ausente, expirada ou de outro evento |
| `403` | `csrf_invalid` | Falta ou não coincide o `X-CSRF-Token` |
| `404` | `invitation_not_found` | Token inválido, convite revogado ou reclamado por outro navegador (resposta sempre igual) |
| `404` | `event_not_found` / `invitation_not_found` | Recurso de gestão inexistente |
| `409` | `event_not_scheduled`, `event_cancelled`, `event_completed`, `rsvp_deadline_passed`, `email_duplicate`, `invitation_limit_reached` | Conflito de estado |
| `422` | `validation_failed` | Validação Zod; inclui `fields` |
| `429` | `rate_limited` | Limite de pedidos excedido (activo em todos os ambientes) |
| `500` | `internal_error` | Erro inesperado; sem stack trace |

## Autenticação e cookies

Não existem contas. Há dois tipos de capacidade:

1. **Sessão de gestão** — o segredo do link de gestão é trocado por uma
   sessão curta:
   - Cookie `apupu_host_<eventId>`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/host`.
   - Cookie `apupu_csrf_host_<eventId>`: legível por JS, `Path=/api/v1`.
   - O segredo nunca é devolvido em JSON nem escrito em logs.
2. **Capacidade do convidado** — emitida no primeiro claim:
   - Cookie `apupu_guest`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/public/invitations`.
   - Cookie `apupu_csrf_guest`: legível por JS, `Path=/api/v1`.
   - É reutilizada pelo mesmo navegador para reclamar convites adicionais.

Pedidos mutáveis autenticados por cookie exigem o cabeçalho
`X-CSRF-Token` com o valor derivado (`csrf_token` devolvido em JSON e no
cookie legível).

## Fluxo do anfitrião

### 1. Criar evento

`POST /api/v1/events`

```json
{
  "event": {
    "title": "Casamento da Ana e do Paulo",
    "host_name": "Ana",
    "host_email": "ana@exemplo.ao",
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
    { "name": "João", "email": "joao@exemplo.ao", "phone": null }
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
{ "name": "João", "email": "joao@exemplo.ao", "phone": "+244900000000" }
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

`/health` fica fora do limite global para não afectar orquestradores.
