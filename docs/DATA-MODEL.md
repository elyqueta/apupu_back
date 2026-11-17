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
(auditoria e validade dos links de gestão),
[`../migrations/1739900000004_account-retention-index.js`](../migrations/1739900000004_account-retention-index.js)
(índice de retenção de contas),
[`../migrations/1739900000005_invitations-account-email-index.js`](../migrations/1739900000005_invitations-account-email-index.js)
(índice de "Meus convites") e
[`../migrations/1739900000006_event-managers.js`](../migrations/1739900000006_event-managers.js)
(gestores de evento por email).

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
| `cover_url` | text | imagem de capa (upload ou URL); `NULL` usa a arte do template |
| `cover_hash` | text | SHA-256 do último ficheiro carregado; idempotência do upload |
| `cover_public_id` | text | identificador Cloudinary para remoção/substituição |
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
`(event_id, send_status)` e `invitations_account_email_idx` —
`lower(guest_email)` parcial (`WHERE claim_revoked_at IS NULL`) para
"Meus convites".

Invariantes:

1. O claim é atómico: `claim_hash` só é preenchido se ainda for nulo.
2. `claim_hash` nunca é devolvido pela API.
3. Recusar um convite não afecta os restantes convidados.
4. O token não expira e não é de uso único: o primeiro navegador que
   abre o link fica com a capacidade; os seguintes precisam do mesmo
   cookie. `token_encrypted` permite reconstruir o URL para o anfitrião
   (`invitation_url`) e para os emails.
5. `POST .../resend` reutiliza o mesmo token; o link partilhado
   continua válido.
6. `POST .../revoke` preenche `claim_revoked_at` de forma permanente.
   Não existe, nesta fase, rotação/reativação do token: o convite
   revogado devolve `invitation_url: null` e o link público passa a
   `404 invitation_not_found`.

### "Meus convites" (conta convidada)

A lista `GET /api/v1/host/invitations` associa convites à conta pelo
**email**, sem coluna nova nem migração:

- `lower(invitations.guest_email) = lower(hosts.email)`.
- `hosts.email` é `citext`; `guest_email` é `text`, daí o `lower()` nos
  dois lados.
- Só contas com `hosts.email_verified_at` preenchido podem consultar.
- Convites com `claim_revoked_at` preenchido são excluídos.
- A associação é avaliada em cada pedido: um convite criado antes da
  conta aparece assim que o registo/verificação desse email termina; se
  a conta mudar de email, deixa de ver os convites do email antigo.
- Ordenação: `events.starts_at ASC NULLS LAST, invitations.id ASC`
  (aceita `order=desc`).

Não é criada uma FK convite↔conta (opção B) nesta fase. Se no futuro
for necessário manter o histórico após mudança de email, ou impedir que
um email reutilizado veja convites antigos, será preciso adicionar uma
coluna explícita (`account_id`) e migrar os convites existentes.

## `event_host_sessions`

Sessões de gestão por evento. Foram renomeadas de `host_sessions` na
migração de contas para não colidir com as sessões de conta.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `token_hash` | text | único; HMAC do token de sessão |
| `role` | text | `host` \| `manager`; por omissão `host` |
| `manager_id` | uuid | FK → `event_managers` (`ON DELETE CASCADE`); só em sessões de gestor |
| `expires_at` | timestamptz | `> created_at` |
| `revoked_at` | timestamptz | |
| `created_at` | timestamptz | |
| `last_used_at` | timestamptz | |

Constraints: `event_host_sessions_role_check`; `role='manager'` exige
`manager_id` e `role='host'` exige `manager_id` nulo
(`event_host_sessions_manager_role_check`). As sessões existentes
ficaram com `role='host'`.

Índices: `event_host_sessions_event_id_idx`,
`event_host_sessions_expiry_idx` e
`event_host_sessions_manager_id_idx`. A sessão é sempre limitada a um
evento; o UUID do evento nunca é autorização.

## `event_managers`

Gestores de um evento, identificados pelo email. Um gestor pode não ter
conta: nesse caso usa o link próprio enviado por email. Quando cria
conta com o mesmo email verificado, passa também a ver o evento no
workspace.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`) |
| `email` | citext | normalizado para minúsculas na fronteira |
| `token_hash` | text | único; HMAC-SHA256 do link do gestor |
| `token_expires_at` | timestamptz | validade do link |
| `revoked_at` | timestamptz | remoção lógica |
| `last_used_at` | timestamptz | último uso do link |
| `created_at` / `updated_at` | timestamptz | |

Constraints: `event_managers_event_email_unique` — `(event_id, email)`
único, para que o mesmo email não seja adicionado duas vezes ao mesmo
evento; `token_hash` é único. Índices: `event_managers_event_id_idx` e
`event_managers_email_idx`.

Invariantes:

1. O token em claro só existe no pedido que o gera; a base guarda o
   HMAC e a outbox guarda uma cópia cifrada até ao envio do email.
2. Usar o link de um gestor **não** roda o token: a sessão emitida é
   independente e expira ao fim de `HOST_SESSION_TTL_MINUTES`.
3. Remover um gestor preenche `revoked_at`, apaga o token e revoga as
   sessões desse gestor. Re-adicionar o mesmo email reativa a linha e
   emite um token novo.
4. Uma conta só obtém acesso de gestor se `hosts.email_verified_at`
   estiver preenchido e o email coincidir (`citext`) com o da linha
   activa.
5. O anfitrião (`events.host_id`) nunca é uma linha de
   `event_managers`; o próprio email é rejeitado ao adicionar.

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

O feed é append-only. O anfitrião pode eliminar uma actividade apenas na
área de gestão do evento (`DELETE /host/events/{eventId}/activity/{activityId}`);
a notificação associada em `host_notifications` é removida na mesma
operação.

## `host_notifications`

Notificações in-app por anfitrião, geradas a partir de actividades e
lembretes. É uma camada separada de `event_activity` (que continua
append-only).

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | FK → `hosts` (`ON DELETE CASCADE`) |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`); nulo em notificações globais |
| `activity_id` | uuid | FK → `event_activity` (`ON DELETE CASCADE`); nulo em lembretes |
| `kind` | text | `rsvp_accepted`, `rsvp_declined`, `guest_added`, `reminder_sent`, `event_created`, `event_upcoming`, `rsvp_deadline`, `task_assigned`, `task_completed` |
| `title` | text | |
| `body` | text | opcional |
| `metadata` | jsonb | por omissão `{}`; apenas identificadores |
| `dedupe_key` | text | único por anfitrião; garante lembretes idempotentes |
| `read_at` | timestamptz | nulo = não lida |
| `dismissed_at` | timestamptz | remoção lógica; nulo = visível |
| `created_at` | timestamptz | |

Índices: `host_notifications_host_created_idx`
(`host_id, created_at DESC, id DESC`),
`host_notifications_host_unread_idx` (`host_id` parcial, não lidas e não
removidas), `host_notifications_host_activity_uidx` (único por
`host_id, activity_id`) e `host_notifications_host_dedupe_uidx` (único
por `host_id, dedupe_key`). Os lembretes (`event_upcoming`,
`rsvp_deadline`) são sincronizados na leitura e deduplicados por
`dedupe_key`.

## `host_tasks`

Tarefas do workspace, globais ou ligadas a um evento.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | FK → `hosts` (`ON DELETE CASCADE`); proprietário |
| `event_id` | uuid | FK → `events` (`ON DELETE CASCADE`); nulo = global |
| `manager_id` | uuid | FK → `event_managers` (`ON DELETE SET NULL`); nulo = tarefa do anfitrião |
| `label` | text | |
| `done` | boolean | por omissão `false` |
| `completed_at` | timestamptz | preenchido quando `done=true` |
| `created_at` / `updated_at` | timestamptz | |

Constraints: `host_tasks_manager_event_check` (`manager_id IS NULL OR
event_id IS NOT NULL`). Índices: `host_tasks_host_id_idx`,
`host_tasks_event_id_idx`, `host_tasks_host_created_idx`
(`host_id, created_at DESC, id DESC`) e `host_tasks_manager_idx`
(`manager_id` parcial).

Um gestor só vê as tarefas atribuídas ao seu email (gestor activo) e só
pode alternar `done`; o anfitrião vê e gere todas as suas.

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
`manage_link_rotated`, `manage_link_resent`, `manager_added`,
`manager_removed`, `manager_invite_resent`, `manager_link_used`.

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

Tipos de mensagem: `manage_link`, `manager_invite`, `invitation`,
`reminder`, `decline_notification`, `event_cancelled`,
`email_verification`, `registration_otp`, `host_welcome`,
`password_reset`, `profile_reminder`.

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
| Convite de gestor | `manager_invite:<eventId>:<managerId>:<uuid>` |
| Reenvio do convite de gestor | `manager_invite:<eventId>:<managerId>:resend:<uuid>` |
| Verificação de email | `email_verification:<hostId>:<uuid>` |
| Código OTP de registo | `registration_otp:<email>:<uuid>` |
| Boas-vindas | `host_welcome:<hostId>` |
| Reposição de senha | `password_reset:<hostId>:<uuid>` |

Todas as mensagens passam pela outbox, incluindo o link de gestão e os
convites de gestor. Nesses casos o token em claro é guardado cifrado em
`token_encrypted` até o worker renderizar o email;
`events.manage_token_hash` (anfitrião) e `event_managers.token_hash`
(gestor) continuam a ser os únicos registos verificáveis. A entrega é
reenviada pelo worker como qualquer outra (com backoff) e a linha é
cancelada quando o evento ou o convite deixam de a justificar.

Os convites de gestor (`manager_invite`) usam `event_id` e `host_id` e
são independentes do estado do evento: continuam aplicáveis para
reabrir a área de gestão.

As mensagens de conta (`email_verification`, `registration_otp`,
`host_welcome`, `password_reset`, `profile_reminder`) usam `host_id`
(nulo no OTP, que antecede a conta) e não dependem de um evento.

O worker corre em processo próprio (`npm run worker`) ou, em
protótipos, dentro da API com `OUTBOX_IN_API=true`. Cada `INSERT`
dispara `pg_notify('outbox_new')`, que acorda os processos à escuta
(`LISTEN outbox_new`); o polling por `OUTBOX_SCAN_INTERVAL_MS` continua
como fallback para lembretes agendados e notificações perdidas.

## Relações

- Uma conta (`hosts`) tem um perfil, zero ou mais sessões de conta,
  tokens de verificação/reposição, tarefas e eventos.
- As verificações de registo (`registration_verifications`) são
  independentes de `hosts`: existem antes de a conta ser criada e são
  identificadas pelo email.
- Um evento pertence a zero ou uma conta (`host_id`; nulo em eventos
  legados) e tem zero ou mais convites, gestores, sessões de gestão,
  actividades e entregas de email.
- Um gestor (`event_managers`) pertence a exactamente um evento e pode
  originar sessões de gestão (`event_host_sessions.manager_id`) e
  entregas de email.
- Um convite pertence a exactamente um evento e pode originar
  actividades e entregas.
- Uma notificação (`host_notifications`) pertence a uma conta e,
  opcionalmente, a um evento e a uma actividade. Apagar a actividade (na
  gestão do evento) remove a notificação associada; apagar o evento
  remove as notificações do evento.
- Uma tarefa pertence a uma conta (`host_id`) e, opcionalmente, a um
  evento e a um gestor. Apagar o gestor mantém a tarefa, mas limpa
  `manager_id` (`ON DELETE SET NULL`).
- Apagar uma conta remove em cascata perfil, sessões, tokens, tarefas,
  notificações e entregas; os eventos ficam com `host_id` nulo
  (`ON DELETE SET NULL`).
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
  revalidada imediatamente antes do envio. Várias instâncias do worker
  podem correr em paralelo sem enviarem a mesma entrega.
- Entregas presas em `processing` (processo morto a meio do envio) são
  recuperadas após o intervalo de recuperação e voltam a `pending`.
- Todas as leituras e mutações do workspace são limitadas pelo `host_id`
  da sessão ou, para eventos geridos, pelo email verificado da conta
  associado a um gestor activo. A ausência de acesso devolve `404`, não
  `403`.
- As mutações estruturais (estado, email do anfitrião, gestores e
  convites existentes) são restritas ao anfitrião e devolvem `403
  host_action_forbidden` a um gestor.
- Adicionar um gestor é atómico por `(event_id, email)`: a violação de
  unicidade é convertida em `409 manager_already_exists`. Remover revoga
  a linha e as sessões do gestor na mesma transacção.
- A sincronização de lembretes em `host_notifications` é idempotente
  graças aos índices únicos por `(host_id, dedupe_key)` e
  `(host_id, activity_id)`. Marcar como lida e remover são limitados ao
  `host_id` da sessão.
- O upload da capa compara o SHA-256 com `cover_hash`: repetir o mesmo
  ficheiro não volta a subir. A remoção/substituição apaga o asset
  antigo do Cloudinary só depois de o evento ficar com o novo valor.
- Eliminar uma actividade exige o papel `host` e remove a notificação
  associada; um gestor recebe `403 host_action_forbidden`.
