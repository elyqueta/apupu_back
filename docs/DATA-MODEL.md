# Modelo de dados (implementação)

PostgreSQL 16. Todas as datas são `timestamptz` (UTC na base; o fuso IANA
do evento é guardado em `events.timezone` para apresentação e cálculo de
lembretes).

Especificação autoritária: [`../backend/architecture-and-data-model.md`](../backend/architecture-and-data-model.md).
Migração: [`../migrations/1739900000000_baseline-apupu.js`](../migrations/1739900000000_baseline-apupu.js).

## `event_templates`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `slug` | text | único |
| `name` | text | |
| `description` | text | opcional |
| `preview_image_url` | text | opcional |
| `supported_fields` | jsonb | lista de campos que o template apresenta |
| `themes` | jsonb | pares `mode`/`palette` permitidos |
| `is_active` | boolean | só templates activos são publicados |
| `sort_order` | integer | ordenação da listagem |
| `created_at` / `updated_at` | timestamptz | |

Infraestrutura de templates. Os templates visuais finais não são criados
pelo código; o seed garante apenas um template neutro (`base`).

## `events`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `manage_token_hash` | text | único; HMAC-SHA256 do link de gestão |
| `manage_token_expires_at` | timestamptz | opcional |
| `manage_token_revoked_at` | timestamptz | opcional |
| `title` | text | |
| `host_name` / `host_email` | text | |
| `starts_at` | timestamptz | instante UTC |
| `ends_at` | timestamptz | opcional; `> starts_at` |
| `timezone` | text | IANA, por omissão `Africa/Luanda` |
| `location_type` | text | `venue` \| `online` |
| `location_name` / `location_address` | text | exigidos conforme o tipo |
| `online_url` | text | exigido quando `location_type=online` |
| `message` / `rules` / `dress_code` | text | opcionais |
| `template_id` | uuid | FK → `event_templates` (`ON DELETE SET NULL`) |
| `theme` | jsonb | `{ mode, palette }` |
| `contribution_enabled` | boolean | |
| `contribution_bank_name` | text | |
| `contribution_account_holder` | text | |
| `contribution_account_reference` | text | |
| `rsvp_deadline` | timestamptz | opcional |
| `status` | text | `draft` \| `scheduled` \| `cancelled` \| `completed` |
| `created_at` / `updated_at` | timestamptz | |

Constraints:

- `events_status_check`: estados permitidos.
- `events_location_type_check`: `venue` ou `online`.
- `events_location_check`: `venue` exige `location_name`; `online` exige
  `online_url`.
- `events_contribution_check`: quando `contribution_enabled=true`, os
  três campos bancários são obrigatórios.
- `events_dates_check`: `ends_at` nulo ou posterior a `starts_at`.

Índices: `events_starts_at_idx`, `events_status_idx`.

## `invitations`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `guest_name` | text | |
| `guest_email` | text | |
| `guest_phone` | text | opcional; nunca usado para envio automático |
| `token_hash` | text | único; HMAC-SHA256 para lookup |
| `token_encrypted` | text | AES-256-GCM; permite reenvios e lembretes |
| `claim_hash` | text | HMAC da capacidade do primeiro navegador |
| `claimed_at` | timestamptz | |
| `claim_revoked_at` | timestamptz | |
| `rsvp_status` | text | `pending` \| `accepted` \| `declined` |
| `rsvp_responded_at` | timestamptz | |
| `rsvp_version` | integer | incrementa em cada mudança de resposta |
| `send_status` | text | `pending` \| `queued` \| `sent` \| `failed` |
| `send_count` | integer | |
| `last_sent_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

Constraints:

- `invitations_rsvp_status_check` e `invitations_send_status_check`.
- `invitations_event_email_unique`: `(event_id, guest_email)` único.

Índices: `event_id`, `(event_id, rsvp_status)`,
`(event_id, send_status)`.

Invariantes:

1. O claim é atómico: `claim_hash` só é preenchido se ainda for nulo.
2. `claim_hash` nunca é devolvido pela API.
3. Recusar um convite não afecta os restantes convidados.

## `host_sessions`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `token_hash` | text | único; HMAC do token de sessão |
| `expires_at` | timestamptz | `> created_at` |
| `revoked_at` | timestamptz | |
| `created_at` | timestamptz | |
| `last_used_at` | timestamptz | |

Índices: `event_id`, `expires_at`. A sessão é sempre limitada a um
evento; o UUID do evento nunca é autorização.

## `email_deliveries` (outbox)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `invitation_id` | uuid | FK → `invitations` (`ON DELETE CASCADE`) |
| `message_type` | text | `manage_link`, `invitation`, `reminder`, `decline_notification`, `event_cancelled` |
| `reminder_kind` | text | `14d`, `7d`, `3d`, `1d` (só lembretes) |
| `recipient_email` | text | |
| `scheduled_for` | timestamptz | instante UTC de envio |
| `status` | text | `pending` \| `processing` \| `sent` \| `failed` \| `cancelled` |
| `attempts` | integer | `>= 0` |
| `next_attempt_at` | timestamptz | backoff exponencial |
| `provider_message_id` | text | |
| `last_error` | text | mensagem operacional, sem tokens |
| `idempotency_key` | text | único |
| `sent_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

Índices: índice parcial `(status, scheduled_for)` para entregas
pendentes, `event_id` e `invitation_id`.

Chaves idempotentes usadas:

| Mensagem | Chave |
|---|---|
| Convite inicial | `invitation:<invitationId>:initial` |
| Reenvio | `invitation:<invitationId>:resend:<uuid>` |
| Lembrete | `reminder:<invitationId>:<scheduledFor ISO>` |
| Aviso de recusa | `decline_notification:<invitationId>:<rsvpVersion>` |
| Cancelamento do evento | `event_cancelled:<invitationId>` |

O link de gestão é enviado de forma síncrona após a transacção de
criação; o resultado é registado em `email_deliveries` com
`message_type=manage_link`, mas essa entrega nunca é reenviada pelo
worker.

## Relações

- Um evento tem zero ou mais convites; um convite pertence a exactamente
  um evento.
- Um evento tem zero ou mais sessões de gestão e entregas de email.
- Apagar um evento remove em cascata convites, sessões e entregas.
- Apagar um convite remove em cascata as suas entregas.

## Regras de concorrência

- Claim: `UPDATE ... WHERE claim_hash IS NULL` dentro de transacção; dois
  pedidos simultâneos nunca reclamam o convite em navegadores distintos.
- RSVP: exige capacidade válida e actualiza de forma atómica; repetir o
  mesmo estado é idempotente.
- Recusa e cancelamento de lembretes ocorrem na mesma transacção lógica.
- A outbox reserva linhas com `FOR UPDATE SKIP LOCKED`; cada entrega é
  revalidada imediatamente antes do envio.
