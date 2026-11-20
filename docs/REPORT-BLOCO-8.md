# Relatório — Bloco 8 (backend)

**Branch:** `feat/ajustes-fase-4`  
**Data:** 2026-11-20  
**Âmbito:** perfis no painel admin e relatórios PDF (sem envio de email).

## Decisões aplicadas

- Relatório global: **download no `/admin`**, **semanal** (segunda-feira,
  09:00, `Africa/Luanda`) e em **PDF**.
- Detalhe do utilizador com capa, avatar, dados, eventos e equipas — o mesmo
  conteúdo usado pelo modal do frontend.
- PDFs semanais guardados em `admin_weekly_reports.content` (`bytea`),
  com retenção de 12 semanas. Sem sistema de ficheiros, serviço de objectos,
  dependência ou segredo novo.
- Idempotência por `UNIQUE (week_start)`; reservas abandonadas há mais de uma
  hora são reclamadas e falhas libertam a reserva.
- Imagens só de `res.cloudinary.com` do cloud configurado, com timeout e
  limite de tamanho: `avatar_url`/`cover_url` são definidos pelo utilizador,
  pelo que aceitar URLs arbitrárias seria SSRF.
- Atividade administrativa explícita: `admin_audit_log` guarda apenas
  `admin_id`, pelo que `list()`/`recent()` fazem join com `hosts` e
  `host_profiles` e devolvem `admin_email` e `admin_name`. Nenhum hash, token ou
  conteúdo de mensagem entra no DTO.
- Refresh do front local: em `NODE_ENV=development` o cookie `apupu_auth` usa
  `Path=/`, para que o browser o envie ao pedir a página (`/painel`) e o SSR do
  Angular consiga reautenticar. Produção e teste mantêm `Path=/api/v1`; o
  cookie de CSRF mantém esse path em todos os ambientes.

## Ficheiros alterados

| Área | Ficheiros |
|---|---|
| Migração | `migrations/1739900000025_admin-weekly-reports.js` |
| Configuração | `src/config/env.ts`, `package.json` (`admin-report:run`), `src/server.ts`, `src/worker.ts` |
| DTOs/repositórios | `src/repositories/host.repository.ts`, `src/repositories/adminProfile.repository.ts`, `src/repositories/adminWeeklyReport.repository.ts`, `src/repositories/adminAudit.repository.ts` |
| Serviços | `src/services/admin.service.ts`, `src/services/adminReport.service.ts`, `src/services/adminReportScheduler.ts`, `src/services/pdf/adminProfileDocument.ts` |
| Utilitários | `src/utils/cookie.util.ts` |
| API | `src/controllers/admin.controller.ts`, `src/routes/v1/admin.routes.ts`, `src/schemas/admin.schemas.ts`, `src/config/swagger-schemas/contoContigo.schemas.ts`, `src/config/swagger-responses.ts` |
| Script | `src/scripts/runAdminReport.ts` |
| Testes | `tests/adminProfileReports.test.ts`, `tests/adminAuditList.test.ts`, `tests/authCookiePath.test.ts` |
| Docs | `docs/PLANO-BLOCO-8.md`, `docs/API-CONTRACT.md`, `docs/DECISIONS.md`, `docs/REPORT-BLOCO-8.md` |

## Dados devolvidos ao admin

`GET /admin/users` e `GET /admin/users/:userId` passam a incluir
`avatar_url`, `cover_url`, `phone`, `birth_date`, `locale`, `timezone` e
`profile_complete`. O detalhe acrescenta `events[]` e `teams[]` (limite de
50 cada), incluindo eventos próprios e geridos por email. Não são expostos
`password_hash`, hashes de imagem, `public_id` do Cloudinary, tokens nem OTPs.

## Rotas novas

| Método | Rota | Resultado |
|---|---|---|
| `GET` | `/api/v1/admin/users/:userId/report` | PDF individual com capa/avatar, dados, eventos e equipas |
| `GET` | `/api/v1/admin/reports/all` | PDF global imediato, com resumo agregado e uma página por perfil |
| `GET` | `/api/v1/admin/reports/weekly` | Lista das últimas 12 semanas prontas para download |
| `GET` | `/api/v1/admin/reports/weekly/:reportId/download` | PDF guardado, `Content-Disposition` e `Cache-Control: private, no-store` |

Todas passam por `hostAccountAuth`, `requireSuperAdmin` e
`adminActionLimiter`. Exportações manuais são auditadas
(`admin_user_report_exported`, `admin_all_users_report_exported`); o job
semanal não escreve em `admin_audit_log` porque `admin_id` é FK para
`hosts`. As quatro rotas e as duas de utilizadores estão documentadas em
`@openapi`, com schemas `AdminUser`, `AdminUserDetail` e `AdminWeeklyReport`
e respostas de erro com envelope JSON.

## Correcção pós-implementação

`teamsForUser()` contava os membros com `tm.deleted_at IS NULL`, mas a coluna
de remoção lógica de `team_members` é `removed_at` (`deleted_at` pertence a
`teams`). O detalhe do utilizador e o PDF falhavam com `42703`. A query usa
agora `tm.removed_at IS NULL`; `tests/adminProfileRepository.test.ts` valida a
SQL e o mapeamento sem depender de base de dados.

## Agendamento

- `startAdminReportScheduler()` corre na API e no worker, verificando a cada
  minuto a hora local de Luanda. Não duplica trabalho entre instâncias.
- `npm run admin-report:run` permite disparo manual/cron externo e reposição
  de uma semana falhada.
- Variáveis (todas com default): `ADMIN_WEEKLY_REPORT_ENABLED=true`,
  `ADMIN_WEEKLY_REPORT_LOCAL_HOUR=9`, `ADMIN_WEEKLY_REPORT_LOCAL_WEEKDAY=1`,
  `ADMIN_WEEKLY_REPORT_RETENTION_WEEKS=12`,
  `ADMIN_WEEKLY_REPORT_IMAGE_TIMEOUT_MS=3000`.

## Verificação

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run build` ✅
- `npm test -- --run` ✅ — **37 ficheiros / 317 testes passados** (6 ficheiros
  e 89 testes ignorados pela configuração existente).
- Migração 0025 aplicada na base de desenvolvimento, revertida (`down`) e
  aplicada de novo (`up`) com sucesso.
- Testes novos cobrem: DTO rico sem dados sensíveis, 404, PDF válido e nome
  do ficheiro, cálculo da semana em Luanda, unicidade/claim, retenção,
  libertação da reserva em falha e presença dos paths no OpenAPI.
- O teste global do spec (`tests/app.test.ts`) continua a exigir corpo JSON
  em todas as respostas de erro documentadas; foram acrescentadas as
  respostas `AdminForbidden`, `UserNotFound` e `ReportNotFound` e o mapa por
  operação.

## Commits locais (sem push)

- `99b3854` — enriquecimento dos DTOs com perfil, eventos e equipas
- `d39da25` — geração e armazenamento dos PDFs semanais
- `07d3582` — rotas de exportação e download
- `83318cb` — testes do detalhe, dos PDFs, do job e do OpenAPI
- `db6f450` — plano, relatório e contrato
- `0e50511` — correcção da descrição YAML com dois pontos
- `d555f7a` — correcção de `team_members.removed_at` no detalhe do perfil
- `8d670b3` — identidade do autor nas entradas de auditoria
- `f414b99` — cookie de conta com `Path=/` apenas em desenvolvimento

