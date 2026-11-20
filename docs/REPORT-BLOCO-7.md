# Relatório — Bloco 7 (backend)

**Branch:** `feat/ajustes-fase-4`  
**Data:** 2026-11-20  
**Âmbito:** backend apenas. Nenhum ficheiro do frontend foi alterado.

## Fonte e alinhamento

- `docs/PLANO-BLOCO-7.md` foi lido antes da implementação; a numeração
  das migrações já era 0023/0024 e foi mantida.
- O contrato HTTP fornecido e `docs/API-CONTRACT.md` definem as rotas,
  os envelopes, os DTOs em `snake_case` e os corpos de erro.
- O frontend do Bloco 7 ficou a cargo do utilizador e foi implementado
  em paralelo; este relatório cobre apenas a API.
- A integração foi feita em `feat/ajustes-fase-4` porque merge/push
  estão proibidos. Nada foi enviado para remoto.

## Dados e migrações

| Migração | Conteúdo |
|---|---|
| `1739900000023_support-messages.js` | `support_messages` (com `status CHECK`, índice por `status`/`created_at`) e alargamento do `CHECK` de `host_audit_log` com `support_message_resolved` e `newsletter_subscription_removed`. |
| `1739900000024_newsletter-subscriptions.js` | `newsletter_subscriptions` e índice único em `lower(email)`. |

Ambas usam `IF NOT EXISTS`/`IF EXISTS`, são reversíveis e foram
testadas em `down` + `up`. O `down` da 0023 repõe a lista anterior de
acções permitidas em `host_audit_log` e remove as entradas novas; o
`up` recria a versão alargada. Não foi criada uma terceira migração.

## Rotas públicas

Montadas em `/api/v1/public`, sem sessão, cookie ou `X-CSRF-Token`.

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/support` | `{ name, email, message }` | `201 { data: { id, created_at } }` |
| `POST` | `/newsletter` | `{ email }` | `201 { data: { subscribed: true } }` |

- Validação estrita com Zod: nome 2–120, email válido até 254 e
  mensagem 10–2000 caracteres; campos extra dão `422 validation_failed`.
- Email aparece sem espaços nas extremidades e em minúsculas no
  serviço; `invalid_json` dá `400`.
- Newsletter é idempotente por `lower(email)` com
  `INSERT ... ON CONFLICT DO NOTHING`. A resposta é sempre igual, quer
  o email já exista quer seja novo, sem dupla confirmação e sem envio
  de email.
- Não há resposta automática por email ao formulário de apoio.
- Limites próprios por IP (`support` e `newsletter`), com baldes
  separados, reutilizando `PUBLIC_RATE_LIMIT_*`; o limite global
  `/api/v1` continua activo. Não foram criadas variáveis de ambiente.

## Rotas administrativas

Montadas em `/api/v1/admin`, depois de `hostAccountAuth` +
`requireSuperAdmin`. Escritas exigem `X-CSRF-Token`; todas as rotas
usam `adminActionLimiter` pela conta autenticada.

| Método | Rota | Finalidade |
|---|---|---|
| `GET` | `/support` | Lista com `q`, `status=open\|resolved\|all`, `from`, `to`, paginação |
| `GET` | `/support/:messageId` | Detalhe da mensagem |
| `POST` | `/support/:messageId/resolve` | Marca como resolvida (idempotente) |
| `GET` | `/newsletter` | Lista com `q`, `from`, `to`, paginação |
| `GET` | `/newsletter/export` | CSV com os mesmos filtros, sem paginação |
| `DELETE` | `/newsletter/:subscriptionId` | Remove a subscrição |

- `q` usa `ILIKE` com escaping de `%`, `_` e `\`; `from`/`to` filtram
  `created_at`; ordenação por `created_at DESC, id DESC`.
- `page` começa em 1 e `page_size` vai até 100. IDs inexistentes dão
  `404 support_message_not_found` ou
  `404 newsletter_subscription_not_found`.
- `resolve` preserva `resolved_at`/`resolved_by` quando repetido; a
  remoção não é idempotente e devolve `404` na segunda chamada.
- Exportação: `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="newsletter.csv"`,
  cabeçalho exacto `email,created_at`, CRLF, prefixo `'` em valores
  iniciados por `=`, `+`, `-` ou `@` e aspas duplas duplicadas.
- Todas as acções admin, incluindo listagens e exportação, são
  registadas em `admin_audit_log`. Resolução e remoção também entram
  em `host_audit_log`. A metadata contém apenas identificadores: nunca
  conteúdo de mensagens nem emails.

## Contrato e documentação

- `docs/API-CONTRACT.md` descreve as 8 operações, envelopes, filtros,
  CSV, erros e DTOs.
- `docs/DECISIONS.md` regista CSRF público, ausência de confirmação
  por email, limites, CSV, auditoria e numeração das migrações.
- Todos os handlers novos têm bloco `@openapi` com pelo menos uma
  resposta não-2xx em JSON e `$ref`s resolvíveis; `tests/app.test.ts`
  valida o documento gerado.

## Commits

| Commit | Descrição |
|---|---|
| `50b867a` | `feat(db): add support and newsletter tables` |
| `cb4df65` | `feat(bloco-7): add support and newsletter APIs` |
| `6908f6c` | `test: cover block 7 schemas, idempotency and CSV` |
| `32e2fdf` | `docs: document block 7 API and decisions` |
| (este ficheiro) | `docs: add block 7 backend report` |

## Verificação

Executado em 2026-11-20, depois de todos os commits de código:

- `npm run typecheck` — passou.
- `npm run lint` — passou (0 erros, 0 avisos).
- `npm run build` — passou.
- `npm test -- --run` — passou: 32 ficheiros, 298 testes; 6 ficheiros
  e 89 testes ignorados pela configuração existente. O único aviso é
  o pré-existente do Vite sobre `configLoader: 'native'`.
- OpenAPI gerado com as 8 paths novas; testes de `$ref` e de corpo JSON
  em respostas de erro passaram.
- Migrações:
  - da base com 0024 aplicada: `migrate:down` (0024),
    `migrate:down` (0023) e `migrate:up` (0023 + 0024) — passaram;
  - também foi verificada a reversão completa até 0022 e a subida
    subsequente — passou;
  - estado final: 0023 e 0024 aplicadas, sem migrações pendentes.

## Testes manuais sugeridos

Com `$BASE_URL` apontando para o backend e um email de exemplo:

```bash
curl -i -X POST "$BASE_URL/api/v1/public/support" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ana Silva","email":"ana@exemplo.pt","message":"Olá, preciso de ajuda com o convite."}'

curl -i -X POST "$BASE_URL/api/v1/public/newsletter" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@exemplo.pt"}'
curl -i -X POST "$BASE_URL/api/v1/public/newsletter" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ANA@exemplo.pt"}'
```

Repetir a segunda chamada (variação de maiúsculas incluída) para
confirmar a mesma resposta `201`. Depois, com uma conta super admin:

```bash
curl -i -c /tmp/apupu-admin.cookies -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@exemplo.pt","password":"<senha>"}'
# Usar o csrf_token devolvido em X-CSRF-Token e o cookie guardado:
curl -i -b /tmp/apupu-admin.cookies "$BASE_URL/api/v1/admin/support"
curl -i -b /tmp/apupu-admin.cookies "$BASE_URL/api/v1/admin/newsletter/export?q=exemplo.pt" \
  -o newsletter.csv
curl -i -b /tmp/apupu-admin.cookies -H 'X-CSRF-Token: <token>' \
  -X POST "$BASE_URL/api/v1/admin/support/<messageId>/resolve"
curl -i -b /tmp/apupu-admin.cookies -H 'X-CSRF-Token: <token>' \
  -X DELETE "$BASE_URL/api/v1/admin/newsletter/<subscriptionId>"
```

Conferir no CSV o cabeçalho `email,created_at`, finais de linha CRLF,
o nome de ficheiro `newsletter.csv` e a protecção contra fórmulas;
confirmar que uma conta não-super-admin recebe `403 admin_forbidden`
e que uma escrita sem CSRF recebe `403 csrf_invalid`.

## Estado da entrega

Backend do Bloco 7 completo e verificado. Commits locais na branch
`feat/ajustes-fase-4`; **não foi feito push, merge nem rebase**.
