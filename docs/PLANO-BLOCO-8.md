# Plano — Bloco 8 (backend): perfis no admin e relatórios PDF

## Objectivo

Permitir que o super admin veja, na área `/admin`, utilizadores com foto, abra um
detalhe com o mesmo aspecto do perfil do anfitrião (capa, avatar, dados, eventos,
equipas) e descarregue relatórios PDF: um por perfil e um global gerado
**semanalmente**.

## Decisões já confirmadas

| Tema | Decisão |
| --- | --- |
| Entrega do relatório global | Download no `/admin` (sem envio de email) |
| Periodicidade | Semanal, segunda-feira às 09:00 de `Africa/Luanda` |
| Formato | PDF (por perfil e global) |
| Modal de detalhe | Espelha a página de perfil do anfitrião, incluindo capa |
| Novas dependências | Nenhuma — `pdfkit`, `qrcode`, `svg-to-pdfkit` e fontes já existem |

### Decisão de armazenamento e retenção dos PDFs semanais

Os PDFs semanais serão guardados **no Postgres**, numa tabela
`admin_weekly_reports` (`bytea`), e não no sistema de ficheiros. Motivos:

- o sistema de ficheiros de ambientes type Render/container é efémero e não é
  partilhado entre instâncias; a base já é persistida e com backup;
- o download no `/admin` passa a funcionar a partir de qualquer instância;
- evita novas dependências (serviço de objectos) e novos segredos.

Retenção: manter as **12 semanas** mais recentes, configurável por
`ADMIN_WEEKLY_REPORT_RETENTION_WEEKS` (mínimo 1). A limpeza corre no mesmo job,
depois de gerar o relatório da semana. Um `UNIQUE (week_start)` impede relatórios
duplicados quando existem várias instâncias: apenas a instância que consegue
inserir a linha (`ON CONFLICT DO NOTHING RETURNING id`) gera o PDF; as restantes
não refazem trabalho.

## Fases

### 1. DTOs de utilizador enriquecidos

- `host.repository.ts`: estender `AdminUserListItem` com `avatar_url`,
  `cover_url`, `locale`, `timezone`, `phone`, `birth_date` e
  `profile_complete`; `listForAdmin` e `findById` já seleccionam essas colunas
  via `SELECT_COLUMNS`, apenas é necessário devolvê-las.
- `admin.service.ts`: `listUsers` e `getUser` passam a devolver esses campos.
  `getUser` passa a devolver também `events` e `teams`:
  - eventos: nova variante de `eventRepository.listForAdmin` com filtro exacto
    por `host_id` (e união com `event_managers`, para incluir eventos geridos);
  - equipas: `teamRepository.listForAccess({ hostId: userId, managerEmail: null,
    actorEmail: null, ... })`, limitado a 50; devolver `id`, `name`,
    `member_count`, `event_id`, `event_title`.
- Manter `email_verified_at`, `status`, `is_super_admin`, `created_at` e a
  auditoria (`admin_users_listed` / `admin_user_viewed`) intactos. Nunca devolver
  hashes, `public_id` do Cloudinary, tokens nem OTP.

### 2. Rotas e contrato

Novas rotas GET (todas atrás de `hostAccountAuth` + `requireSuperAdmin` +
`adminActionLimiter`, sem CSRF por serem leituras):

| Rota | Finalidade |
| --- | --- |
| `GET /admin/users/:userId/report` | PDF de um perfil |
| `GET /admin/reports/all` | PDF global sob procura (usa o mesmo renderizador do job) |
| `GET /admin/reports/weekly` | Lista `{ data: [{ id, week_start, generated_at, filename, size_bytes, host_count }] }` |
| `GET /admin/reports/weekly/:reportId/download` | Descarga do PDF com `Content-Disposition` |

- Schemas Zod em `admin.schemas.ts`: `adminUserIdParamsSchema` (já existe) e
  `adminWeeklyReportIdParamsSchema`.
- Registar a tabela `admin_weekly_reports` no `swagger-schemas/contoContigo.schemas.ts`
  e acrescentar anotações `@openapi` a `/admin/users`, `/admin/users/{userId}`,
  às quatro rotas novas. Erros no envelope padrão
  `{ error: { code, message, request_id } }`: `user_not_found`, `report_not_found`,
  `report_not_ready`, `validation_failed`, `admin_forbidden`, `rate_limited`.
- `Content-Type: application/pdf`, `Cache-Control: private, no-store` e nome
  `conto-contigo_perfil_<slug>_<aaaammdd>.pdf` /
  `conto-contigo_relatorio-semanal_<aaaammdd>.pdf`.

### 3. Renderização PDF (sem novas dependências)

- Novo `src/services/pdf/adminProfileDocument.ts`: usa `renderPdf`, `drawTitle`,
  `drawHighlightBlock`, `drawTable` e as fontes existentes. Layout do perfil:
  cabeçalho, capa/avatar (quando as URLs existirem, embed com `fetch` curto e
  timeout, **best-effort** — falha de imagem nunca falha o relatório), dados
  pessoais, estatísticas, tabela de eventos e tabela de equipas. Texto em pt-PT.
- Novo `src/services/adminReport.service.ts`:
  - `userReport(adminId, userId)` — carrega o detalhe enriquecido, audita
    `admin_user_report_exported`, devolve `ReportExport`;
  - `allUsersReport()` — lista todas as contas (pagina em lotes de 100),
    gera um PDF com resumo agregado e uma página por perfil;
  - `generateWeeklyReport()` — calcula a segunda-feira da semana corrente em
    `Africa/Luanda`, tenta inserir a linha `generating`, renderiza, grava o
    `bytea`, actualiza para `ready` e apaga semanas além da retenção; em caso de
    erro apaga a linha para nova tentativa no ciclo seguinte;
  - `listWeeklyReports()` / `getWeeklyReport(id)` — só `status = 'ready'`.

### 4. Agendamento semanal

- `startAdminReportScheduler()` em `src/services/adminReportScheduler.ts`:
  calcula o próximo disparo com `Intl.DateTimeFormat` (`timeZone:
  'Africa/Luanda'`), usa `setTimeout` + `setInterval` de 24 h e chama
  `generateWeeklyReport()`. `stopAdminReportScheduler()` para encerramento
  limpo. Sem dependência de cron.
- `server.ts` inicia o agendador quando `ADMIN_WEEKLY_REPORT_ENABLED` for
  `true` (default `true`). `worker.ts` também o inicia, para o caso de
  `OUTBOX_IN_API=false`.
- Novo script `npm run admin-report:run` (`src/scripts/runAdminReport.ts`)
  para execução manual/cron externo e para testes.
- Variáveis em `config/env.ts` (todas com default, nenhum segredo novo):
  `ADMIN_WEEKLY_REPORT_ENABLED` (true), `ADMIN_WEEKLY_REPORT_LOCAL_HOUR` (9),
  `ADMIN_WEEKLY_REPORT_LOCAL_WEEKDAY` (1),
  `ADMIN_WEEKLY_REPORT_RETENTION_WEEKS` (12),
  `ADMIN_WEEKLY_REPORT_IMAGE_TIMEOUT_MS` (3000).

### 5. Migração

`migrations/1739900000025_admin-weekly-reports.js`, reversível e idempotente:

```sql
CREATE TABLE IF NOT EXISTS admin_weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'ready')),
  filename text NOT NULL,
  content bytea,
  size_bytes integer NOT NULL DEFAULT 0,
  host_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`down`: `DROP TABLE IF EXISTS admin_weekly_reports`. Nenhuma coluna existente é
alterada; a migração não depende de dados.

### 6. Documentação e testes

- `docs/API-CONTRACT.md`: quatro rotas novas, campos novos do detalhe, nomes de
  ficheiros e códigos de erro.
- `docs/DECISIONS.md`: registo das quatro decisões confirmadas, da escolha de
  `bytea` e da retenção de 12 semanas.
- `docs/REPORT-BLOCO-8.md`: relatório final.
- Testes Vitest:
  - `tests/adminProfileExport.test.ts` — DTO enriquecido, auditoria, PDF válido
    (`%PDF-` no início), 404 para utilizador inexistente;
  - `tests/adminWeeklyReport.test.ts` — cálculo da semana em Luanda, unicidade
    por semana, retenção, lista só com `ready`, descarga com cabeçalhos;
  - `tests/adminUserDetail.test.ts` — `listUsers`/`getUser` devolvem
    avatar/cover e eventos/equipas, sem hashes nem `public_id`;
  - estender `tests/bloco7.test.ts`/`bloco5Bloco6.test.ts` apenas se necessário.

### 7. Verificação obrigatória

`npm run typecheck` · `npm run lint` · `npm run build` · `npm test -- --run`;
migração `down` e `up` na base de desenvolvimento; smoke test das rotas com a
conta `csassapa@gmail.com` (já promovida a super admin).

## Melhoria — exposição explícita da atividade administrativa

A atividade recente e a auditoria mostravam chaves cruas (`admin_users_listed`,
`admin_all_users_report_exported`, …) e o ator genérico “Sistema”, porque os
DTOs não devolviam a identidade do admin e o frontend só conhecia cinco acções.

- `adminAudit.repository.ts`: resolver `admin_id` com `hosts`/`host_profiles` e
  devolver `admin_email` e `admin_name` em `list()` e `recent()`.
- `admin.service.ts`: incluir esses campos em `recent_activity` e na lista de
  auditoria, sem expor hashes, tokens nem conteúdo de mensagens.
- Testes: validar que os DTOs incluem o autor e que a consulta continua
  paginada/filtrável.

## Correcção — refresh do front local cai sempre no login

Reproduzido no browser: depois de login, um refresh de `/painel` redirecciona
para `/entrar?returnUrl=%2Fpainel` durante o SSR, sem nenhum pedido
`GET /auth/session` visível na rede.

Causa: `apupu_auth` é gravado com `Path=/api/v1`. O browser só envia cookies
cujo `Path` corresponda ao URL pedido, pelo que **não envia o cookie ao pedir
`/painel`** no dev server (4200). O SSR depende desse cookie (reencaminhado
pelo interceptor) para autenticar; sem ele recebe 401 e o guard redirecciona.
Em produção/teste/Vercel o comportamento não deve mudar.

- Em `NODE_ENV=development`, gravar o cookie de conta com `Path=/`; nos outros
  ambientes manter `Path=/api/v1`. O `clearAuthSession` usa o mesmo valor.
- O cookie de CSRF mantém `Path=/api/v1`: o token do escopo `auth` vem da
  resposta JSON e nunca é lido de cookie pelo frontend.
- Teste: `setAuthSession`/`clearAuthSession` com `NODE_ENV=development` usam
  `path='/'`; com `NODE_ENV=production` mantêm `path='/api/v1'`.

## Fora de âmbito

- Envio do relatório por email (decisão: apenas download no `/admin`).
- Promoção/revogação de super admin por API ou UI — continua exclusivamente
  por SQL.
- Alterações ao layout da página pública do anfitrião; o modal apenas a
  replicas.
- Nova biblioteca de PDF, XLSX ou serviço de objectos.
