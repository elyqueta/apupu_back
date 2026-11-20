# Decisões de engenharia

| Data | Tema | Decisão |
|---|---|---|
| 2026-11-20 | Branch do Bloco 6 | O backend do Bloco 6 é integrado em `feat/ajustes-fase-4` porque as regras de trabalho proíbem merge/push e criar uma branch separada deixaria o front do Bloco 5 e do Bloco 6 desalinhados sem merge. |
| 2026-11-20 | Avatar `public_id` | `avatar_public_id` e `avatar_hash` ficam em `host_profiles`, ao lado de `avatar_url`, e não em `hosts`. |
| 2026-11-20 | Auditoria admin | `admin_audit_log` é append-only; não existem rotas de edição/remoção e a retenção é política de BD. |
