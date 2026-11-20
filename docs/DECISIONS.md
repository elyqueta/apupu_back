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
