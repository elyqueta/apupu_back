# Decisões de engenharia

| Data | Tema | Decisão |
|---|---|---|
| 2026-11-20 | Branch do Bloco 6 | O backend do Bloco 6 é integrado em `feat/ajustes-fase-4` porque as regras de trabalho proíbem merge/push e criar uma branch separada deixaria o front do Bloco 5 e do Bloco 6 desalinhados sem merge. |
| 2026-11-20 | Avatar `public_id` | `avatar_public_id` e `avatar_hash` ficam em `host_profiles`, ao lado de `avatar_url`, e não em `hosts`. |
| 2026-11-20 | Auditoria admin | `admin_audit_log` é append-only; não existem rotas de edição/remoção e a retenção é política de BD. |
| 2026-11-20 | CSRF nos formulários públicos | `/public/support` e `/public/newsletter` não exigem `X-CSRF-Token`: não criam sessão nem capacidade, pelo que não existe segredo de sessão para proteger. O abuso é travado pelo limite por IP (global + balde próprio por formulário). |
| 2026-11-20 | Envio de apoio | Submissão direta, sem confirmação por email e sem resposta automática. O super admin apenas vê, detalha e marca como resolvida; `resolve` é idempotente. |
| 2026-11-20 | Subscrição de novidades | Subscrição direta, sem dupla confirmação. Idempotente por `lower(email)` com `INSERT ... ON CONFLICT DO NOTHING`; a resposta `201 { subscribed: true }` é igual quer o email exista quer não, para não revelar a lista. |
| 2026-11-20 | Limites dos formulários | Reutilizam `PUBLIC_RATE_LIMIT_*`, com chave por IP e baldes separados (`support` e `newsletter`). Não foram introduzidas variáveis de ambiente novas. |
| 2026-11-20 | Exportação CSV | Cabeçalho fixo `email,created_at` com vírgula (contrato do front). Valores iniciados por `=`, `+`, `-` ou `@` recebem `'` e aspas duplas são duplicadas. |
| 2026-11-20 | Auditoria do Bloco 7 | Todas as acções admin (incluindo listagens e exportação) ficam em `admin_audit_log`. A resolução e a remoção também geram entradas em `host_audit_log` com acções novas; a metadata só contém identificadores, nunca conteúdo de mensagens ou emails. |
| 2026-11-20 | Migrações do Bloco 7 | As duas tabelas novas usam 0023/0024. O alargamento do CHECK de `host_audit_log` foi incluído na 0023 (com `down` que repõe a lista anterior) para não criar uma terceira migração. |
| 2026-11-20 | Entrega do relatório global | Apenas download no `/admin`, sem envio por email (decisão do utilizador). |
| 2026-11-20 | Periodicidade e formato | Relatório global semanal, segunda-feira às 09:00 de `Africa/Luanda`; PDF por perfil e global, sem novas dependências (`pdfkit` já existe). |
| 2026-11-20 | Armazenamento dos PDFs semanais | `bytea` em `admin_weekly_reports`, não sistema de ficheiros: ambientes containerizados têm disco efémero e a base já é persistida/com backup. Sem serviço de objectos nem segredos novos. |
| 2026-11-20 | Retenção dos PDFs | 12 semanas por omissão (`ADMIN_WEEKLY_REPORT_RETENTION_WEEKS`); limpeza no próprio job, depois de gerar a semana corrente. |
| 2026-11-20 | Idempotência do job | `UNIQUE (week_start)` + `INSERT ... ON CONFLICT DO NOTHING RETURNING id`: só a instância que inserir gera o PDF. Reservas com mais de uma hora são reclamadas; falha liberta a reserva. |
| 2026-11-20 | Imagens nos PDFs | Só URLs HTTPS de `res.cloudinary.com` do cloud configurado, com timeout e limite de tamanho; `avatar_url`/`cover_url` podem ser definidos pelo utilizador e aceitar URLs arbitrárias seria SSRF. Falha de imagem nunca falha o relatório. |
| 2026-11-20 | Auditoria dos relatórios | Exportações manuais são auditadas; o job semanal não escreve em `admin_audit_log` porque `admin_id` é FK para `hosts` e o agendador não corre com sessão. |
| 2026-11-25 | Estado efetivo de evento (Bloco 15) | Estado efetivo derivado na leitura por `effectiveEventStatus` e materializado a cada 15 min por `eventCompletionScheduler`/`markEndedEventsCompleted`. Fim = `endsAt` ou início do dia seguinte no timezone do evento. Escritas bloqueadas em `completed/cancelled` por `requireActiveEvent`, com `allowGallery` para `/gallery|media`. |
| 2026-11-25 | Fontes PDF locais (Bloco 15) | Catálogo fechado embutido em `src/assets/fonts`; `registerFonts` regista no PDFKit; `resolveCatalogFont` falha em fonte desconhecida/em falta. Sem CDN/fallback silencioso. `npm run build` copia `src/assets` para `dist/assets`. |
| 2026-11-25 | Gratitude template sistema (Bloco 15) | Migração `1739900000034_bloco15_gratitude.js` adiciona `event_templates.kind` (`system|user`) e insere Gratitude como template oficial. PDF Gratitude tem ramo dedicado até Passo 2 unificar em TemplateRenderer. |
| 2026-11-25 | Feed/status público (Bloco 15) | `social.repository` expõe `status` efetivo e ordenação Bloco 15 (ativos→passados→cancelados) em feed, perfis e eventos de comunidade. DTO público inclui `status`. |
