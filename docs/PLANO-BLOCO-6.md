# Plano — Bloco 6: Landing page e painel Super Admin (frontend)

**Data:** 2026-11-20  
**Fonte principal:** `docs/bloco-6-landing-e-super-admin.md` (prevalece sobre a Parte E do `PLANO-BLOCO-5.md`).  
**Branch:** integração em `feat/ajustes-fase-4` (o Bloco 6 foi pedido dentro do mesmo lote de ajustes; criar uma branch separada deixaria o front do Bloco 5 e do Bloco 6 desalinhados sem merge, que as regras proíbem). Decisão registada em `DECISIONS.md`.  
**Estado:** plano escrito antes de qualquer código de landing/admin.

## 1. Rotas (`src/app/app.routes.ts`)

| Rota | Componente | Acesso |
|---|---|---|
| `''` | `LandingPage` (novo, pública) | Todos; com sessão → redirect `/painel` |
| `entrar` | `AuthPage` (existente, `mode='login'`) | Pública |
| `criar-conta` | `AuthPage` (existente, `mode='register'`) | Pública |
| `painel` | `DashboardPage` (existente) | Autenticado |
| `admin` | `AdminPage` (novo) | `superAdminGuard` |
| `admin/visao-geral` | `AdminOverviewComponent` | `superAdminGuard` |
| `admin/eventos` | `AdminEventsComponent` | `superAdminGuard` |
| `admin/utilizadores` | `AdminUsersComponent` | `superAdminGuard` |
| `admin/auditoria` | `AdminAuditComponent` | `superAdminGuard` |

Links antigos para login continuam a funcionar; a landing passa a ser a porta de entrada. `ProtectedNoticeComponent` (faixa "Protótipo — versão em teste") aparece em todas as páginas públicas: landing, `/entrar`, `/criar-conta`, recuperação de senha e convite.

## 2. Componentes frontend

### Landing (`src/app/features/landing/`)

| Ficheiro | Responsabilidade |
|---|---|
| `landing.page.ts` / `.html` | Composição das secções por ordem do Bloco 6; sem dependência da API; `signal` para menu móvel. |
| `landing-hero.component.ts` | Título, subtítulo, CTAs "Criar conta"/"Entrar" e mockup de convite em telemóvel (HTML/CSS com tokens, sem imagem nova). |
| `landing-benefits.component.ts` | 4 cards: convites editáveis, convidados/equipas, confirmações/mensagens, partilha link/WhatsApp. |
| `landing-steps.component.ts` | 4 passos numerados com ícones do `ICONS`. |
| `landing-audience.component.ts` | "Para quem é": anfitriões, gestores/equipas, convidados. |
| `landing-about.component.ts` | Missão, estado de protótipo, próximos passos (honesto e curto). |
| `landing-ns2.component.ts` | Produto NS2 Innovation + contacto/link de apoio. |
| `landing-footer.component.ts` | Links, termos/privacidade placeholder, "Um produto NS2 Innovation", ano. |
| `protected-notice.component.ts` | Faixa de protótipo reutilizável (também usada em auth e convite). |
| `landing.page.spec.ts` | Secções presentes, CTAs com as rotas corretas, aviso de protótipo, menu móvel. |

SEO: `Title` + `Meta` do Angular no construtor da página (title, description, `og:title`, `og:description`, `og:image`, `og:type`, `og:url`), sem nova dependência. `index.html` mantém valores por omissão para as rotas públicas.

### Admin (`src/app/features/admin/`)

| Ficheiro | Responsabilidade |
|---|---|
| `admin.page.ts` / `.html` | Shell com menu lateral de admin (dentro do menu da app), header com botão Voltar e `<router-outlet>` das abas. |
| `admin-overview.component.ts` | 4 cards de estatísticas + atividade recente (10 itens), com skeleton/erro/vazio. |
| `admin-events.component.ts` | Lista paginada (10/página), pesquisa e filtros estado/anfitrião/data na API; cards com `app-action-menu` (ancorado ao card, padrão Bloco 5) para "Ver detalhe" e "Cancelar evento". |
| `admin-event-detail-dialog.component.ts` | Modal só de leitura: anfitrião, datas, convidados, equipa, estado. |
| `admin-cancel-dialog.component.ts` | Modal/bottom sheet: **motivo obrigatório** (mín. 10 caracteres) + OTP de 6 dígitos enviado para o e-mail do admin; reenviar com cooldown; erros genéticos pt-PT. Confirmação destrutiva passa também por `app-confirm-dialog`. |
| `admin-users.component.ts` | Lista paginada (10/página), pesquisa e filtros papel/estado/data; detalhe; ações suspender/reativar e revogar sessões. Botões desativados para o próprio admin com tooltip "Não podes suspender a tua própria conta." / "Não podes alterar o teu próprio papel.". |
| `admin-audit.component.ts` | Lista paginada de auditoria (quem, quê, quando, motivo), só leitura. |
| `admin.guard.ts` | `CanActivateFn`: usa `SessionCacheService`/`ApiClient /auth/me`; sem `is_super_admin` → `/painel`. Resposta de acesso negado genérica. |
| `admin.models.ts`, `admin.repository.ts` | Modelos e chamadas `/admin/*`. |
| `*.spec.ts` | Guard, paginação/filtros, cancelamento OTP e auto-suspensão bloqueada. |

Todos os textos entram em `src/app/core/i18n/translations.ts` (pt-PT principal + en), sem texto hardcoded em templates. Cards com 44 px de alvo, `rounded-2xl/4xl`, tokens existentes, claro/escuro.

## 3. Endpoints consumidos (contrato com o backend do Bloco 6)

| Método | Rota | Uso |
|---|---|---|
| GET | `/admin/overview` | 4 estatísticas + atividade recente |
| GET | `/admin/events?q=&status=&host=&from=&to=&page=&page_size=` | Lista de eventos |
| GET | `/admin/events/:eventId` | Detalhe só de leitura |
| POST | `/admin/events/:eventId/cancel` | `{ reason, otp }` — motivo obrigatório |
| POST | `/admin/events/:eventId/cancel/otp` | Envio/reenvio de OTP (rate-limited) |
| GET | `/admin/users?q=&role=&status=&from=&page=&page_size=` | Lista de utilizadores |
| GET | `/admin/users/:userId` | Detalhe do utilizador |
| POST | `/admin/users/:userId/suspend` | Suspender conta (bloqueado para si próprio) |
| POST | `/admin/users/:userId/reactivate` | Reativar conta |
| POST | `/admin/users/:userId/revoke-sessions` | Revogar sessões |
| GET | `/admin/audit?q=&action=&from=&page=&page_size=` | Registo de auditoria |

Erros: envelope existente, códigos `admin_forbidden`, `admin_self_action`, `admin_otp_invalid`, `validation_failed`, `event_cancelled`; mensagens pt-PT e genéricas quando apropriado.

## 4. Tabelas/banco (responsabilidade do backend, documentadas aqui para alinhamento)

- `hosts.is_super_admin` (promoção só por SQL: `UPDATE hosts SET is_super_admin = true WHERE email = '<email>';` — **nenhum valor real em código/docs**).
- `hosts.status` existente (`active|suspended|deleted`) usado para suspender/reativar.
- `events.cancelled_at`, `events.cancelled_reason`, `events.cancelled_by`.
- `admin_audit_log` (ator, ação, entidade, motivo, metadados, data).
- Tabela de OTP reutilizável com hash, finalidade (`event_cancel`), expiração, tentativas e consumido.

## 5. Ordem e verificação

1. `docs: plano do bloco 6` (este ficheiro).
2. `feat(landing): public landing page with prototype notice and SEO`.
3. `feat(admin): guard, shell and overview cards`.
4. `feat(admin): events list and OTP cancellation flow`.
5. `feat(admin): users list, suspension and session revocation`.
6. `feat(admin): audit log and tests`.

Verificação: `npm run build`, `npm test -- --watch=false`, `npm run lint`, `npx tsc --noEmit`; revisão manual em 360×640 e desktop, claro/escuro, com sessão e sem sessão.

## 6. Backend — implementação nesta branch

A landing e o painel admin do frontend ficam com o utilizador. O backend
segue a fonte principal `apupu_front/docs/bloco-6-landing-e-super-admin.md`
e implementa apenas os endpoints abaixo.

### 6.1 Modelo de dados

| Objecto | Alteração |
|---|---|
| `hosts.is_super_admin` | `boolean not null default false`. É a representação concreta do papel `super_admin` pedido no documento-fonte; a promoção continua a ser só por SQL, sem valor real em código/docs. |
| `events` | `cancelled_at timestamptz`, `cancelled_reason text`, `cancelled_by uuid null references hosts(id)`. Nada é apagado. |
| `registration_verifications` | Coluna `purpose text not null default 'registration'` (backfill não destrutivo) para separar OTP de registo de OTP de `event_cancel`. Tentativas/expiração/cooldown são reutilizados. |
| `admin_audit_log` | `id uuid pk`, `admin_id uuid not null references hosts(id)`, `action text not null`, `target_type text`, `target_id uuid`, `reason text`, `metadata jsonb not null default '{}'`, `created_at timestamptz not null default now()`. Append-only. |

### 6.2 Rotas e regras

Todas sob `/api/v1`, depois de `hostAccountAuth` (sessão `apupu_auth` +
CSRF) e `requireSuperAdmin`. `GET` usa leitura paginada; escritas usam
`writeLimiter` e um limitador dedicado para OTP/ações admin.

| Método | Rota | Regra principal |
|---|---|---|
| GET | `/admin/overview` | Contagens de utilizadores, eventos ativos, cancelados e convites enviados; 10 atividades recentes. |
| GET | `/admin/events` | `q`, `status`, `host`, `from`, `to`, paginação; auditoria da listagem. |
| GET | `/admin/events/:eventId` | Detalhe só de leitura. |
| POST | `/admin/events/:eventId/cancel/otp` | Envia/reenvia OTP para o email do admin; nunca devolve o código. |
| POST | `/admin/events/:eventId/cancel` | `{ reason, otp }`; motivo obrigatório (mín. 10 caracteres) e OTP obrigatório. |
| GET | `/admin/users` | `q`, `role`, `status`, `from`, paginação. |
| GET | `/admin/users/:userId` | Detalhe do utilizador. |
| POST | `/admin/users/:userId/suspend` | `hosts.status = 'suspended'`; recusa `admin_self_action`. |
| POST | `/admin/users/:userId/reactivate` | `hosts.status = 'active'`. |
| POST | `/admin/users/:userId/revoke-sessions` | Revoga `host_auth_sessions` do utilizador. |
| GET | `/admin/audit` | `q`, `action`, `from`, paginação; só leitura. |

O super admin nunca pode suspender nem alterar o próprio papel. Não
existe rota para alterar papéis — a promoção é apenas SQL.

### 6.3 Cancelamento

- OTP de 6 dígitos, finalidade `event_cancel`, 10 minutos, 5 tentativas,
  cooldown de reenvio de 60 s (variáveis já existentes, com `purpose`).
- Cancelamento atómico: grava `cancelled_at`/`cancelled_reason`/
  `cancelled_by`, escreve `admin_audit_log` e enfileira e-mail de
  `evento_cancelado` ao anfitrião com o motivo. Notificação in-app quando
  o evento tiver `host_id`.
- O e-mail mantém a variante do anfitrião (Bloco 5, Parte H) e acrescenta
  a variante do responsável da plataforma.
- Depois do cancelamento, o guard `event_cancelled` bloqueia escritas; o
  convite público mostra apenas o estado cancelado.

### 6.4 Erros e observabilidade

Envelope `{ error: { code, message, request_id } }` com mensagens pt-PT.
Códigos: `admin_forbidden`, `admin_self_action`, `admin_otp_invalid`,
`validation_failed`, `event_cancelled`, `rate_limited`. Logs estruturados
sem OTP, tokens, senhas ou email em claro.

### 6.5 Ordem de trabalho no backend

1. Migração `1739900000020_super-admin-and-cancellation.js` + `purpose`.
2. `requireSuperAdmin`, `requireActiveEvent` e montagem no router v1.
3. Serviço/controlador/rotas `/admin` com auditoria e OTP.
4. Ajuste do catálogo de e-mails e do estado público cancelado.
5. Testes com mocks e verificação (`typecheck`, `build`, `lint`, `test`).
6. `docs/REPORT-BLOCO-6.md` com o feito e o que fica para o frontend.

## 7. Fora de âmbito

- Landing e painel admin do frontend (responsabilidade do utilizador).
- Fluxo de promoção a super admin na UI (o Elizandro promove por SQL).
- Cancelamento de evento pelo anfitrião e regras de evento cancelado — Bloco 5, Parte H (backend nesta branch).
- Landing em outras línguas além do par pt-PT/en já existente.
