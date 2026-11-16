# Modelo de dados (implementação)

PostgreSQL 16. Todas as datas são `timestamptz` (UTC na base; o fuso IANA
do evento é guardado em `events.timezone` para apresentação e cálculo de
lembretes).

Especificação autoritária: [`../backend/architecture-and-data-model.md`](../backend/architecture-and-data-model.md).
Migrações:
[`../migrations/1739900000000_baseline-apupu.js`](../migrations/1739900000000_baseline-apupu.js)
(base) e
[`../migrations/1739900000001_host-accounts.js`](../migrations/1739900000001_host-accounts.js)
(contas, perfil, sessões de conta e suporte ao frontend),
[`../migrations/1739900000002_host-audit-log.js`](../migrations/1739900000002_host-audit-log.js)
(auditoria e validade dos links de gestão) e
[`../migrations/1739900000004_account-retention-index.js`](../migrations/1739900000004_account-retention-index.js)
(índice de retenção de contas).

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
| `host_id` | uuid | FK → `hosts` (`ON DELETE SET NULL`); nulo em eventos legados |
| `manage_token_hash` | text | único; HMAC-SHA256 do link de gestão |
| `manage_token_expires_at` | timestamptz | validade do link (30 dias por omissão); a migração preencheu os links activos existentes |
| `manage_token_revoked_at` | timestamptz | opcional |
| `title` | text | |
| `host_name` / `host_email` | text | |
| `category` | text | `wedding` \| `birthday` \| `corporate` \| `baby` \| `other`; opcional |
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
- `events_category_check`: categoria nula ou num dos valores permitidos.

Índices: `events_starts_at_idx`, `events_status_idx`, `events_host_id_idx`.

## `invitations`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `guest_name` | text | |
| `guest_email` | text | |
| `guest_phone` | text | opcional; nunca usado para envio automático |
| `table_name` | text | opcional; mesa/lugar indicado pelo anfitrião |
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

## `event_host_sessions`

Sessões de gestão por evento do fluxo legado (link secreto). Foram
renomeadas de `host_sessions` na migração de contas para não colidir com
as sessões de conta.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `token_hash` | text | único; HMAC do token de sessão |
| `expires_at` | timestamptz | `> created_at` |
| `revoked_at` | timestamptz | |
| `created_at` | timestamptz | |
| `last_used_at` | timestamptz | |

Índices: `event_host_sessions_event_id_idx`,
`event_host_sessions_expiry_idx`. A sessão é sempre limitada a um
evento; o UUID do evento nunca é autorização.

## `hosts`

Conta de anfitrião.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `email` | citext | único; normalizado para minúsculas na fronteira |
| `password_hash` | text | Argon2id; nunca devolvido nem registado |
| `email_verified_at` | timestamptz | nulo até à verificação |
| `status` | text | `active` \| `suspended` \| `deleted` |
| `failed_login_attempts` | integer | `>= 0` |
| `locked_until` | timestamptz | bloqueio temporário após falhas |
| `last_login_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

Constraints: `hosts_email_unique`, `hosts_status_check`,
`hosts_failed_login_attempts_check`. Índices: `hosts_status_idx` e
`hosts_retention_idx` (expressão `COALESCE(last_login_at, created_at)`,
para o job de retenção).

O job `npm run retention:run` elimina contas com
`COALESCE(last_login_at, created_at)` anterior a
`ACCOUNT_RETENTION_MONTHS` (por omissão 24). Perfil, sessões, tokens,
tarefas e entregas de email são apagados em cascata; os eventos ficam
com `host_id = NULL`. Os OTP de registo do mesmo email também são
removidos. A execução é feita em lotes com `FOR UPDATE SKIP LOCKED` e
regista apenas contagens.

## `host_profiles`

Perfil da conta, numa relação 1:1 com `hosts`.

| Coluna | Tipo | Notas |
|---|---|---|
| `host_id` | uuid | PK e FK → `hosts` (`ON DELETE CASCADE`) |
| `display_name` | text | opcional |
| `phone` | text | opcional |
| `birth_date` | date | opcional; data de calendário no passado |
| `locale` | text | `pt-AO` \| `en`; por omissão `pt-AO` |
| `timezone` | text | IANA; por omissão `Africa/Luanda` |
| `avatar_url` | text | opcional; URL (por URL ou upload assinado para o Cloudinary) |
| `created_at` / `updated_at` | timestamptz | |

Constraints: `host_profiles_locale_check`,
`host_profiles_birth_date_check`. `birth_date` é PII e só é devolvida ao
próprio anfitrião.

## `host_auth_sessions`

Sessões de conta (`apupu_auth`), independentes das sessões por evento.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | FK → `hosts` (`ON DELETE CASCADE`) |
| `token_hash` | text | único; HMAC do token de sessão |
| `csrf_hash` | text | HMAC do token CSRF derivado |
| `user_agent_hash` | text | HMAC do user-agent; opcional |
| `expires_at` | timestamptz | `> created_at` |
| `revoked_at` | timestamptz | |
| `last_used_at` | timestamptz | |
| `created_at` | timestamptz | |

Constraints: `host_auth_sessions_expiry_check`. Índices:
`host_auth_sessions_host_id_idx`, `host_auth_sessions_expiry_idx`.

## `email_verifications` e `password_resets`

Tokens de uso único enviados por email.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | FK → `hosts` (`ON DELETE CASCADE`) |
| `token_hash` | text | único; HMAC do token |
| `expires_at` | timestamptz | validade configurável |
| `consumed_at` | timestamptz | preenchido no consumo atómico |
| `created_at` | timestamptz | |

Índices por `host_id` e `expires_at`. O token em claro existe apenas no
link entregue; nunca é persistido.

## `registration_verifications`

Verificação de email por código OTP antes da criação da conta. Cada
linha representa um pedido de código; o código e o token em claro nunca
chegam à base de dados.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `email` | citext | email em verificação; pode ainda não ter conta |
| `code_hash` | text | HMAC do código, ligado ao email |
| `attempts` | integer | tentativas falhadas; `>= 0` |
| `expires_at` | timestamptz | validade do código |
| `verified_at` | timestamptz | preenchido quando o código é aceite |
| `verification_token_hash` | text | único; HMAC do token de criação |
| `verification_token_expires_at` | timestamptz | validade do token |
| `consumed_at` | timestamptz | preenchido no consumo atómico |
| `created_at` / `updated_at` | timestamptz | |

Constraints: `registration_verifications_attempts_check`. Índices:
`registration_verifications_email_idx` (`email`, `created_at DESC`),
`registration_verifications_expiry_idx` e
`registration_verifications_token_idx` (parcial, só com token).

Pedir um novo código invalida os pedidos anteriores do mesmo email. O
token de criação é de uso único, ligado ao email e consumido dentro da
transacção que cria a conta.

## `event_activity`

Feed de actividade por evento.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `invitation_id` | uuid | FK → `invitations` (`ON DELETE SET NULL`) |
| `kind` | text | `rsvp_accepted`, `rsvp_declined`, `guest_added`, `reminder_sent`, `event_created` |
| `guest_name` | text | opcional |
| `metadata` | jsonb | por omissão `{}` |
| `at` | timestamptz | |

Constraints: `event_activity_kind_check`. Índices:
`event_activity_event_id_idx` e `event_activity_at_idx`.

## `host_tasks`

Tarefas do workspace, globais ou ligadas a um evento.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | FK → `hosts` (`ON DELETE CASCADE`) |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`); nulo = global |
| `label` | text | |
| `done` | boolean | por omissão `false` |
| `created_at` / `updated_at` | timestamptz | |

Índices: `host_tasks_host_id_idx`, `host_tasks_event_id_idx`.

## `host_audit_log`

Registo append-only de eventos críticos. Não tem chaves estrangeiras:
`host_id` e `event_id` são UUIDs simples para que o registo sobreviva à
eliminação da conta ou do evento.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | actor, quando existe conta |
| `event_id` | uuid | evento relacionado, quando aplicável |
| `action` | text | ver lista de acções |
| `outcome` | text | `success` \| `failure` |
| `ip` | inet | IP do pedido |
| `request_id` | text | correlação com `X-Request-Id` |
| `metadata` | jsonb | identificadores e estados; nunca tokens nem PII |
| `at` | timestamptz | instante UTC |

Constraints: `host_audit_log_outcome_check` e
`host_audit_log_action_check`. Acções permitidas: `login_success`,
`login_failure`, `login_locked`, `registration_code_requested`,
`registration_code_verified`, `registration_code_failed`,
`registration_completed`, `email_verified`,
`password_changed`, `password_reset`, `profile_updated`,
`event_created`, `event_deleted`, `guest_added`, `guest_updated`,
`guest_deleted`, `guest_invitation_resent`, `guest_access_revoked`,
`manage_link_rotated`, `manage_link_resent`.

Índices: `host_audit_log_host_at_idx` (`host_id`, `at DESC`),
`host_audit_log_event_at_idx` (`event_id`, `at DESC`) e
`host_audit_log_at_idx` (`at DESC`).

A escrita é best-effort: uma falha de auditoria não bloqueia a operação
de negócio e é registada no log interno. Não existe endpoint de leitura
nesta fase.

## `email_deliveries` (outbox)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`); **nulo** em mensagens de conta |
| `invitation_id` | uuid | FK → `invitations` (`ON DELETE CASCADE`) |
| `host_id` | uuid | FK → `hosts` (`ON DELETE CASCADE`); mensagens de conta |
| `message_type` | text | ver lista abaixo |
| `reminder_kind` | text | `14d`, `7d`, `3d`, `1d` (só lembretes) |
| `recipient_email` | text | |
| `scheduled_for` | timestamptz | instante UTC de envio |
| `status` | text | `pending` \| `processing` \| `sent` \| `failed` \| `cancelled` |
| `attempts` | integer | `>= 0` |
| `next_attempt_at` | timestamptz | backoff exponencial |
| `provider_message_id` | text | |
| `last_error` | text | mensagem operacional, sem tokens |
| `idempotency_key` | text | único |
| `token_encrypted` | text | AES-256-GCM; verificação, OTP, reposição de senha |
| `sent_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

Tipos de mensagem: `manage_link`, `invitation`, `reminder`,
`decline_notification`, `event_cancelled`, `email_verification`,
`registration_otp`, `host_welcome`, `password_reset`,
`profile_reminder`.

Índices: índice parcial `(status, scheduled_for)` para entregas
pendentes, `event_id`, `invitation_id` e `host_id`.

Chaves idempotentes usadas:

| Mensagem | Chave |
|---|---|
| Convite inicial | `invitation:<invitationId>:initial` |
| Reenvio | `invitation:<invitationId>:resend:<uuid>` |
| Lembrete | `reminder:<invitationId>:<scheduledFor ISO>` |
| Aviso de recusa | `decline_notification:<invitationId>:<rsvpVersion>` |
| Cancelamento do evento | `event_cancelled:<invitationId>` |
| Link de gestão (criação) | `manage_link:<eventId>` |
| Link de gestão (rotação) | `manage_link:<eventId>:rotate:<uuid>` |
| Link de gestão (reenvio) | `manage_link:<eventId>:resend:<uuid>` |
| Verificação de email | `email_verification:<hostId>:<uuid>` |
| Código OTP de registo | `registration_otp:<email>:<uuid>` |
| Boas-vindas | `host_welcome:<hostId>` |
| Reposição de senha | `password_reset:<hostId>:<uuid>` |

O link de gestão é enviado de forma síncrona após a transacção de
criação; o resultado é registado em `email_deliveries` com
`message_type=manage_link`, mas essa entrega nunca é reenviada pelo
worker. As mensagens de conta (`email_verification`, `registration_otp`,
`host_welcome`, `password_reset`, `profile_reminder`) usam `host_id`
(nulo no OTP, que antecede a conta) e não dependem de um evento.

## Relações

- Uma conta (`hosts`) tem um perfil, zero ou mais sessões de conta,
  tokens de verificação/reposição, tarefas e eventos.
- As verificações de registo (`registration_verifications`) são
  independentes de `hosts`: existem antes de a conta ser criada e são
  identificadas pelo email.
- Um evento pertence a zero ou uma conta (`host_id`; nulo em eventos
  legados) e tem zero ou mais convites, sessões de gestão, actividades e
  entregas de email.
- Um convite pertence a exactamente um evento e pode originar
  actividades e entregas.
- Apagar uma conta remove em cascata perfil, sessões, tokens, tarefas e
  entregas; os eventos ficam com `host_id` nulo (`ON DELETE SET NULL`).
- Apagar um evento remove em cascata convites, sessões de gestão,
  actividades, tarefas ligadas e entregas.
- Apagar um convite remove em cascata as suas entregas.

## Regras de concorrência

- Registo: a unicidade do email é garantida por `hosts_email_unique`; a
  violação é convertida em `409 email_already_registered`.
- OTP de registo: pedir um código consome os pendentes do mesmo email;
  as tentativas são incrementadas atomicamente e o código é invalidado
  ao atingir `REGISTRATION_OTP_MAX_ATTEMPTS`. O token de criação é
  consumido com `consumed_at IS NULL` e ligado ao email.
- Verificação de email e reposição de senha: `consumed_at IS NULL` no
  `UPDATE` torna o consumo atómico; o mesmo link nunca é usado duas
  vezes.
- Login: falhas incrementam `failed_login_attempts`; ao atingir o limite,
  `locked_until` bloqueia temporariamente novas tentativas.
- Claim: `UPDATE ... WHERE claim_hash IS NULL` dentro de transacção; dois
  pedidos simultâneos nunca reclamam o convite em navegadores distintos.
- RSVP: exige capacidade válida e actualiza de forma atómica; repetir o
  mesmo estado é idempotente.
- Recusa e cancelamento de lembretes ocorrem na mesma transacção lógica.
- A outbox reserva linhas com `FOR UPDATE SKIP LOCKED`; cada entrega é
  revalidada imediatamente antes do envio.
- Todas as leituras e mutações do workspace são limitadas por
  `events.host_id = sessão.host_id`; a ausência de posse devolve `404`,
  não `403`.
