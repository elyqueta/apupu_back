# Relatório — Bloco 6 (backend)

**Branch:** `feat/ajustes-fase-4`  
**Data:** 2026-11-20  
**Âmbito:** backend apenas. Nenhum ficheiro do frontend foi alterado.

## Fonte e alinhamento

- O documento `apupu_front/docs/bloco-6-landing-e-super-admin.md` foi
  tratado como fonte principal e prevalece sobre a Parte E do
  `PLANO-BLOCO-5.md`.
- `docs/PLANO-BLOCO-6.md` foi escrito **antes** de qualquer código das
  rotas administrativas e descreve endpoints, tabelas e decisões.
- A landing e o painel admin do frontend ficam com o utilizador; este
  relatório cobre apenas a API.
- A integração foi feita em `feat/ajustes-fase-4` porque merge/push
  estão proibidos; registado em `docs/DECISIONS.md`.

## Super admin

- `hosts.is_super_admin` (migração `1739900000020`) é a única fonte do
  papel. Não existe rota para promover, despromover ou alterar papéis;
  a promoção é feita por SQL, sem valor real em config.
- `requireSuperAdmin` corre depois de `hostAccountAuth` e devolve
  `403 admin_forbidden` com o envelope padrão.
- `GET /api/v1/auth/session` passou a expor `is_super_admin` em
  `HostDto` / `toHostDto()`, lido a partir de `host.isSuperAdmin`, para
  que o `superAdminGuard` do front possa autorizar o painel `/admin`.
- Auto-protecção: o admin não pode suspender a própria conta, revogar
  as próprias sessões nem suspender outro super admin
  (`403 admin_self_action`).

## Rotas administrativas

Montadas em `/api/v1/admin`, todas com sessão de conta + papel
`super_admin`; escritas exigem `X-CSRF-Token` e usam limites dedicados
por conta autenticada (`adminOtpLimiter`, `adminActionLimiter`).

| Método | Rota | Finalidade |
|---|---|---|
| `GET` | `/overview` | Contagens globais e 10 acções recentes |
| `GET` | `/events` | Lista global com `q`, `status`, `host`, datas, ordenação e paginação |
| `GET` | `/events/:eventId` | Detalhe de um evento |
| `POST` | `/events/:eventId/cancel/otp` | Envia o OTP de cancelamento |
| `POST` | `/events/:eventId/cancel` | Cancela com `otp` + `reason` obrigatório (mín. 10 caracteres) |
| `GET` | `/users` | Lista de contas com `q`, `role`, `status`, `from` e paginação |
| `GET` | `/users/:userId` | Detalhe seguro da conta (sem senha/token) |
| `POST` | `/users/:userId/suspend` | Suspende e revoga sessões |
| `POST` | `/users/:userId/reactivate` | Reativa a conta |
| `POST` | `/users/:userId/revoke-sessions` | Revoga todas as sessões da conta |
| `GET` | `/audit` | Consulta paginada do registo de auditoria |

As listagens também são auditadas: o documento-fonte pede registo de
todas as acções admin, incluindo consultas.

## Auditoria

- Tabela `admin_audit_log` (append-only): `admin_id`, `action`,
  `target_type`, `target_id`, `reason`, `metadata`, `created_at`.
- Não existem rotas de edição ou remoção; a retenção é política de base
  de dados.
- Acções registadas incluem `admin_overview_viewed`,
  `admin_events_listed`, `admin_event_viewed`, `admin_cancel_otp_requested`,
  `admin_event_cancelled`, `admin_users_listed`, `admin_user_viewed`,
  `admin_user_suspended`, `admin_user_reactivated`,
  `admin_sessions_revoked`, `admin_audit_listed`.
- Nenhuma senha, token, OTP ou código de acesso entra em `metadata`.

## OTP de cancelamento

- Finalidade dedicada: `registration_verifications.purpose =
  'event_cancel'`; outbox `registration_otp` com
  `payload: { purpose: 'event_cancel' }` e template
  `cancelamento_codigo`.
- 6 dígitos, 10 minutos, 5 tentativas e cooldown de 60 segundos.
- O código nunca é devolvido na API; a resposta só traz
  `expires_at` e `resend_available_at`.
- Tanto o anfitrião como o super admin usam o mesmo verificador. O
  anfitrião pode cancelar sem motivo; o super admin não pode.
- Texto pt-PT consistente em todas as escritas ligadas ao evento:
  "Este evento foi cancelado. Já não é possível fazer alterações."
  (`409 event_cancelled`).

## Verificação

- `npm run typecheck` — passou.
- `npm run build` — passou.
- `npm run lint` — passou (0 erros, 0 avisos).
- `npm test -- --run` — passou: 31 ficheiros, 285 testes; 6 ficheiros
  e 89 testes ignorados pela configuração existente.
- Migrações: ver `REPORT-BLOCO-5.md`; a sequência final deixou a base
  sem migrações pendentes.
- Contrato actualizado em `docs/API-CONTRACT.md`; decisões em
  `docs/DECISOES-PRODUTO.md` (§§26–29) e `docs/DECISIONS.md`.

## Estado da entrega

Os dois últimos ajustes pedidos para integração (`is_super_admin` no
DTO de sessão e filtro `event_id` na caixa de entrada) estão
implementados e verificados, mas **não foram cometidos**: ficam para
revisão antes de qualquer commit.
