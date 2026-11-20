# Relatório — Bloco 5 (backend)

**Branch:** `feat/ajustes-fase-4`  
**Data:** 2026-11-20  
**Âmbito:** backend apenas. Nenhum ficheiro do frontend foi alterado.

## Parte G — Cloudinary

- `host_profiles.avatar_public_id` / `avatar_hash` e limpeza do asset
  anterior ao substituir ou remover o avatar (`setAvatarFromUrl`,
  `uploadAvatar`, `removeAvatar`, `DELETE /host/profile/avatar`).
- `src/scripts/cleanupCloudinary.ts` com `npm run cloudinary:cleanup`:
  - `--dry-run` por omissão; só `--apply` apaga;
  - ignora assets com menos de 24 horas;
  - apenas pastas configuradas e validadas por prefixo exacto;
  - referenciados em `host_profiles`/`events` são sempre mantidos;
  - URLs externas nunca entram na limpeza (não têm `public_id`);
  - remoção via Admin API é best-effort e falhas são logadas.
- Commit: `5fd2a27 feat(cloudinary): track and clean orphan avatars`.
- Nota: a migração `1739900000022_avatar-public-id.js` foi corrigida
  pelo utilizador depois de um erro `42703`; não foi voltada a editar.

## Parte H — Evento cancelado

- Migração `1739900000020`: `cancelled_at`, `cancelled_reason`,
  `cancelled_by` em `events`; `purpose` em
  `registration_verifications`; `is_super_admin` em `hosts`;
  `admin_audit_log`.
- `requireActiveEvent` montado no router v1, antes dos routers de
  domínio. Ignora GET/HEAD/OPTIONS e o próprio cancelamento; resolve o
  evento por `eventId`, `event_id` no corpo, token de convite/convite
  de equipa, `taskId`, `teamId` e `invitationId`.
- Erro uniforme: 409 `event_cancelled` — "Este evento foi cancelado.
  Já não é possível fazer alterações." — também em
  `invitationService.respond()`.
- Cancelamento atómico em `eventService.cancel()`: grava estado/motivo/
  actor, cancela lembretes, enfileira `evento_cancelado` para os
  convidados elegíveis e escreve auditoria.
- OTP de cancelamento (`purpose = 'event_cancel'`, 10 min, 5 tentativas,
  cooldown de 60 s) reutiliza a outbox `registration_otp` com novo
  template `cancelamento_codigo`. O código nunca volta na API.
- Rotas do anfitrião:
  - `POST /host/events/:eventId/cancel/otp`
  - `POST /host/events/:eventId/cancel` (`otp` obrigatório, `reason`
    opcional).

## Parte F — Caixa de entrada

- Migração `1739900000021`: `message_answer`, `message_answered_at`,
  `message_read_at` em `invitations`; novo tipo `invitation_reply` na
  outbox.
- `GET /host/inbox` com `q`, `event_id`, `read`, `answered`, `from`,
  `to` e paginação; `POST /host/inbox/:invitationId/read`;
  `POST /host/inbox/:invitationId/answer`.
- A resposta fica no convite, aparece no DTO público
  (`guest.message_answer`) e é enviada por e-mail
  (`resposta_mensagem`). Se a fila falhar, a resposta continua visível.
- Decisão registada em `docs/DECISOES-PRODUTO.md` (§26).

## Parte D — Links e acesso do gestor

- Link do gestor **inalterado**: default 1 semana, configurável, máx.
  fim do evento + 1 dia. `generateToken()` não foi alterado.
- Link do convite: máx. fim do evento + 30 dias; nova rota
  `PATCH /host/events/:eventId/invitations/:invitationId/link`.
- Troca de código pelo próprio gestor:
  `POST /host/manager/access-code` (sessão de gestão + CSRF), que
  devolve o novo código uma vez e revoga sessões antigas do evento.
- Decisão registada em `docs/DECISOES-PRODUTO.md` (§27).

## Verificação

Executado em 2026-11-20, depois de todos os ajustes:

- `npm run typecheck` — passou (sem erros).
- `npm run build` — passou.
- `npm run lint` — passou (0 erros, 0 avisos).
- `npm test -- --run` — passou: 31 ficheiros, 285 testes; 6 ficheiros
  e 89 testes ignorados conforme a configuração existente.
- `npm run migrate:down` / `npm run migrate:up` — passou. A migração 22
  tinha sido aplicada antes das migrações 20 e 21 existirem, pelo que o
  `check-order` impediu a corrida normal; foi necessário usar
  `--no-check-order` para revertê-la e voltar a aplicar 21 e 22. Nenhum
  ficheiro de migração foi editado nesse processo. `npm run migrate:up`
  final devolve `No migrations to run!`.
- Testes adicionados: `tests/avatarCleanup.test.ts`,
  `tests/cloudinaryCleanup.test.ts`, `tests/bloco5Bloco6.test.ts`.

## Por fazer

- Nada no backend do Bloco 5. Os ecrãs de caixa de entrada, partilha e
  gestão de acesso são frontend (responsabilidade do utilizador).
