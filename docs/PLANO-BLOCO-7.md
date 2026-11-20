# Plano — Bloco 7: apoio e novidades (backend)

**Data:** 2026-11-20  
**Branch:** `feat/ajustes-fase-4` (sem push, merge, rebase ou eliminação de branches).  
**Decisões do utilizador:** ver `docs/DECISIONS.md` e `apupu_front/docs/DECISIONS.md`.

## Objetivo

Fornecer as APIs para (1) mensagens de apoio enviadas por formulário público e geridas pelo super admin, e (2) subscrições de novidades geridas pelo super admin. Nenhuma alteração ao papel de super admin: a promoção continua por SQL, documentada no front.

## Migrações (reversíveis e idempotentes)

| Ficheiro | Conteúdo |
|---|---|
| `migrations/1739900000030_support-messages.js` | `support_messages` (`id uuid`, `name`, `email`, `message`, `status` com `open`/`resolved`, `resolved_at`, `resolved_by uuid`, `created_at`, `updated_at`), índice por `status, created_at DESC`. |
| `migrations/1739900000031_newsletter-subscriptions.js` | `newsletter_subscriptions` (`id uuid`, `email`, `created_at`), índice único em `lower(email)` para idempotência; `down` remove a tabela. |

Sem dados reais, sem segredos.

## Parte A — Mensagens de apoio

### API pública

`POST /api/v1/public/support` — corpo `{ name, email, message }`.

- Schema Zod em `src/schemas/support.schemas.ts`: nome 2–120, email válido até 254, mensagem 10–2000, `.strict()`; mensagens de erro em pt-PT.
- Controller `src/controllers/support.controller.ts`, serviço `src/services/support.service.ts`, repositório `src/repositories/support.repository.ts`, tipos em `src/types/support.types.ts`.
- Rate limit com o limitador público existente; CSRF conforme o padrão das rotas públicas; sem autenticação.
- Resposta `201 { data: { id, created_at } }` — não devolve dados de contacto além do estritamente necessário.
- Nunca devolver erros de BD ao cliente; falha genérica em pt-PT.

### API de administração (super admin)

Em `src/routes/v1/admin.routes.ts`, depois de `hostAccountAuth` + `requireSuperAdmin`:

| Rota | Uso |
|---|---|
| `GET /admin/support` | Lista paginada: `q`, `status` (`open`/`resolved`/`all`), `from`, `to`, `page`, `page_size`. |
| `GET /admin/support/:messageId` | Detalhe completo. |
| `POST /admin/support/:messageId/resolve` | Marca como resolvida; idempotente; `requireAuthCsrf` + `adminActionLimiter`. |

- Schemas em `src/schemas/admin.schemas.ts`; DTOs em `src/dto/support.dto.ts`.
- Auditoria com `auditService.recordRequest` e nova ação em `AUDIT_ACTIONS`: `support_message_resolved` (sem expor o conteúdo da mensagem nos metadados).
- `assertNotSelf` não se aplica.
- Listas e detalhe não expõem telefone nem dados além dos enviados no formulário.

## Parte B — Novidades

### API pública

`POST /api/v1/public/newsletter` — corpo `{ email }`.

- Schema Zod em `src/schemas/newsletter.schemas.ts`; email válido até 254, `.strict()`.
- `src/controllers/newsletter.controller.ts`, `src/services/newsletter.service.ts`, `src/repositories/newsletter.repository.ts`, tipos em `src/types/newsletter.types.ts`.
- Idempotente: `INSERT ... ON CONFLICT` sobre `lower(email)`; resposta `201/200` com `{ data: { subscribed: true } }` — mesma mensagem quer o email já exista quer seja novo (não revela lista).
- Rate limit público; CSRF conforme rotas públicas; sem confirmação por email (decisão do utilizador).

### API de administração (super admin)

| Rota | Uso |
|---|---|
| `GET /admin/newsletter` | Lista paginada: `q`, `from`, `to`, `page`, `page_size`. |
| `DELETE /admin/newsletter/:subscriptionId` | Remove subscrição; `requireAuthCsrf` + `adminActionLimiter`; auditoria. |
| `GET /admin/newsletter/export` | CSV com `email,created_at` (escape de fórmulas: prefixar `'` em valores que começam com `=+-@`); `Content-Disposition: attachment`. |

- Schemas/DTOs/tipos conforme Parte A; a exportação usa o mesmo filtro da lista.
- Nenhum email real em código, config, logs ou documentação.

## Parte C — Contrato, testes e documentação

- `docs/API-CONTRACT.md`: novos endpoints, códigos de erro, limites e paginação.
- `docs/DECISIONS.md`: decisões do utilizador (ver abaixo) e decisões técnicas.
- `docs/REPORT-BLOCO-7.md`: âmbito, commits, verificação.
- Testes em `tests/bloco7.test.ts`: validação de schemas, idempotência da subscrição, mapeamento de DTO, fluxo resolver, escape do CSV. Seguir o padrão de `tests/bloco5Bloco6.test.ts`.

### Decisões do utilizador

| Ponto | Escolha |
|---|---|
| Acesso ao `/admin` | Continuar só por SQL; documentar passo a passo no front, sem script de promoção. |
| Mensagens de apoio | Ver, detalhe e marcar como resolvida; sem resposta por email. |
| Novidades | Subscrição direta, sem dupla confirmação. |
| Gestão das novidades | Listar/pesquisar/remover/exportar CSV no painel super admin; input no rodapé da landing. |

## Verificação (obrigatória)

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test -- --run`.
- `npm run migrate:down` / `npm run migrate:up` (ou comando equivalente do `package.json`) para validar as migrações novas.

## Fora de âmbito

- Papel de super admin: nenhuma rota nova de promoção/despromoção.
- Envio de emails de confirmação ou resposta.
- Alterações a contas, eventos ou convites existentes.
