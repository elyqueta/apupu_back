# Decisões de produto fechadas

Registo das decisões do responsável do produto que estavam em aberto.
Cada decisão indica o estado face à implementação actual. Quando a
implementação ainda não existe, o comportamento descrito é o alvo a
seguir; não deve ser assumido como já disponível.

Data de fecho: 2026-11-15.

| # | Tema | Decisão | Estado |
|---|---|---|---|
| 1 | Contas de anfitrião | Introduzir contas com email e senha, mantendo o link secreto por evento | Implementado |
| 2 | Verificação de email | OTP obrigatório antes de criar a conta; link legado mantido para contas antigas | Implementado |
| 3 | Data de nascimento | Opcional e não bloqueante, `YYYY-MM-DD`, passado, idade mínima 5 | Implementado |
| 4 | Categoria e mesas | Manter `events.category` e `invitations.table_name` | Implementado |
| 5 | Claim automático | Ligar eventos legados à conta após verificação do email | Implementado |
| 6 | Link de gestão | Continua a ser enviado por email ao criar evento com conta | Implementado |
| 7 | Retenção de conta | Apagar conta inativa após 24 meses sem login | Implementado |
| 8 | Data de nascimento (retenção) | Manter enquanto a conta estiver ativa; apagar com a conta ou quando limpa | Implementado |
| 9 | Unsubscribe | Preferências no perfil; transacionais continuam; parar lembretes | Pendente |
| 10 | Domínio e cookies | `api.apupu.ao` + `app.apupu.ao`, SameSite=Lax, CORS restrito | Pendente de configuração |
| 11 | Recuperar link legado | Reenviar novo link de gestão após verificação do email | Implementado |
| 12 | Sessão de conta | 7 dias, renovável | Implementado |
| 13 | Link de gestão (validade) | 30 dias e rotação ao ser usado | Implementado |
| 14 | Rate limiting | Auth + escritas (eventos, convites, RSVP) | Implementado |
| 15 | Auditoria | Eventos críticos com actor e IP | Implementado |
| 16 | Callbacks de email | Webhook assinado: delivered, bounced, complained; supressão | Pendente |
| 17 | Templates finais | Fornecidos pelo responsável, com limites e acessibilidade | Dependência externa |
| 21 | Notificações in-app | Sino com lembretes e actividades; página com filtros, marcar como lida e remover | Implementado |
| 22 | Tarefas por evento | Anfitrião cria para gestores; gestor só marca como cumprida; página global paginada | Implementado |
| 23 | Capa do evento | Upload com progresso/cancelar ou URL; remoção idempotente | Implementado |
| 24 | Convite em qualquer navegador | Conta com o email verificado do convite abre e altera o RSVP | Implementado |

## 1. Contas de anfitrião

Contas aprovadas. O fluxo legado por link secreto mantém-se válido em
paralelo; nenhuma rota antiga é removida por causa das contas.

## 2. Verificação de email

- O registo tem três passos: `request-code` → `verify-code` →
  `register`. A conta **só é criada** depois de o código OTP de 6
  dígitos ser verificado.
- O `verification_token` devolvido por `verify-code` é de uso único,
  ligado ao email e de curta duração.
- A conta é criada já com `email_verified_at` preenchido; não é enviado
  um link de verificação.
- Contas antigas por verificar mantêm `POST /auth/email/verify` e o
  respectivo reenvio.
- Criar, apagar ou gerir eventos continua a exigir email verificado
  (`403 email_not_verified`).
- O registo com OTP liga automaticamente eventos legados com o mesmo
  `host_email` à conta, de forma idempotente.

## 3. Data de nascimento

- Campo opcional `host_profiles.birth_date`, data de calendário
  `YYYY-MM-DD`, no passado.
- Idade mínima `MIN_HOST_AGE_YEARS` (por omissão 5).
- A ausência não bloqueia a conta; apenas faz `profile_complete=false`
  e acrescenta `birth_date` a `missing_fields`.

## 4. Categoria e mesas

- `events.category`: `wedding`, `birthday`, `corporate`, `baby`,
  `other`; opcional.
- `invitations.table_name`: texto opcional, visível apenas ao
  anfitrião; não é exposto na página pública do convite.

## 5. Claim automático de eventos legados

Ao concluir o registo com o email verificado por OTP (ou ao consumir o
link legado, em contas antigas), os eventos com `host_email` igual ao
email verificado e `host_id` nulo passam a pertencer à conta. A operação
é idempotente e só ocorre depois da verificação.

## 6. Link de gestão ao criar evento com conta

`POST /host/events` continua a enfileirar o link de gestão para
`host_email`, tal como `POST /events`. O envelope mantém
`manage_email_status` (`queued` | `failed`) e `deliveries`.

## 7. Retenção de conta — 24 meses

- Uma conta sem login durante 24 meses é apagada.
- O corte usa `COALESCE(last_login_at, created_at)`: contas criadas e
  nunca usadas também são abrangidas.
- A eliminação remove perfil, sessões, tokens, tarefas e entregas de
  email da conta. Os OTP de registo associados ao email também são
  removidos.
- Os eventos ficam com `host_id` nulo (`ON DELETE SET NULL`); não são
  apagados automaticamente pelo processo de retenção.
- O processo é idempotente e regista apenas contagens, nunca PII.
- Implementado em `npm run retention:run`
  (`src/scripts/runRetention.ts`), com lotes
  (`RETENTION_BATCH_SIZE`) e `FOR UPDATE SKIP LOCKED`. O índice
  `hosts_retention_idx` apoia o corte. Recomendado em cron diário.

## 8. Data de nascimento — retenção

- Mantida apenas enquanto a conta estiver ativa.
- É apagada com a conta ou quando o próprio anfitrião envia `null` no
  `PATCH /host/profile`.
- Não é copiada para eventos, convites, logs ou relatórios.

## 9. Unsubscribe — preferências no perfil

- Emails transacionais (verificação, convite, aviso de recusa,
  cancelamento) continuam a ser enviados.
- O anfitrião pode gerir preferências e parar lembretes.
- Os emails devem incluir uma forma de chegar às preferências, sem
  transformar emails transacionais em opcionais.
- Falta implementar: modelo de preferências, endpoints e rodapé dos
  templates.

## 10. Domínio e cookies

- Frontend: `https://app.apupu.ao`.
- API: `https://api.apupu.ao`.
- `CORS_ORIGIN=https://app.apupu.ao`, com credenciais permitidas apenas
  para essa origem.
- Cookies com `SameSite=Lax` e `Secure` em produção. A partilha
  same-site é garantida pelo domínio registável `apupu.ao`; não é
  necessário `Domain=.apupu.ao` para o frontend em `app.apupu.ao`
  chamar a API.
- O cookie `apupu_auth` é `HttpOnly` e pertence a `api.apupu.ao`; como
  o JavaScript de `app.apupu.ao` não o pode ler, o `csrf_token` é
  devolvido em JSON no login e em `GET /auth/session` e enviado em
  `X-CSRF-Token`.
- Falta implementar: variáveis de ambiente de produção e validação da
  origem no deployment.

## 11. Recuperação do link de gestão legado

- Depois de o email estar verificado, o anfitrião pode pedir o reenvio
  de um novo link de gestão em
  `POST /host/events/{eventId}/manage-link/resend`.
- O reenvio roda o token: o link anterior deixa imediatamente de ser
  válido e o novo é enviado para o `host_email` do evento.
- O token nunca é devolvido em JSON; a resposta inclui apenas
  `manage_email_status` e `manage_token_expires_at`.
- Um evento de outra conta devolve `404 event_not_found`; antes da
  verificação do email devolve `403 email_not_verified`.
- A entrega usa a outbox com chave idempotente
  (`manage_link:<eventId>:resend:<uuid>`).

## 12. Sessão de conta — 7 dias

- `AUTH_SESSION_TTL_MINUTES=10080` (7 dias).
- A sessão é renovável por novo login; não há renovação deslizante
  automática em cada pedido.
- Logout, alteração/reposição de senha e suspensão revogam sessões.

## 13. Link de gestão — 30 dias e rotação

- O link de gestão tem validade de 30 dias por omissão
  (`MANAGE_TOKEN_TTL_DAYS`).
- Ao ser usado para abrir uma sessão de gestão, é emitido um novo link
  e o anterior é revogado (rotação).
- O novo link é enviado para `host_email`; nunca é devolvido em JSON.
- `POST /host/session` devolve `manage_email_status` e
  `manage_token_expires_at`; a rotação é atómica com a criação da
  sessão.
- A migração `1739900000002_host-audit-log` preenche
  `manage_token_expires_at` dos links activos existentes.
- O token em claro não é persistido: apenas o HMAC é guardado.

## 14. Rate limiting — auth + escritas

- Limites dedicados em `/auth` por IP e por IP+email, além do limite
  global.
- Limite de escritas (`writeLimiter`) em criação de eventos, perfil,
  avatar, convidados, tarefas, reenvio de link de gestão, reenvio de
  convite, revogação e remoção.
- Limite de RSVP público por IP + token do convite (`rsvpLimiter`).
- A chave do limite de escritas prefere conta autenticada, depois
  evento, depois convite, depois IP.
- Respostas continuam a ser `429 rate_limited`, sem revelar limites
  internos. Variáveis: `WRITE_RATE_LIMIT_WINDOW_MS` /
  `WRITE_RATE_LIMIT_MAX` e `RSVP_RATE_LIMIT_WINDOW_MS` /
  `RSVP_RATE_LIMIT_MAX`.

## 15. Auditoria — eventos críticos

Implementado na tabela append-only `host_audit_log`.

Acções registadas:

- login com sucesso, falha e bloqueio (`login_locked`);
- verificação de email;
- alteração e reposição de senha;
- alteração de perfil (inclui avatar);
- criação e remoção de eventos;
- adição, alteração, remoção, reenvio e revogação de convidados;
- rotação e reenvio do link de gestão.

Cada registo inclui actor (`host_id` quando exista), tipo de evento,
instante UTC, IP e resultado (`success` | `failure`). Nunca inclui
senhas, tokens, `birth_date` ou outros dados pessoais desnecessários.

`host_id` e `event_id` são UUIDs sem chave estrangeira: a auditoria
sobrevive à eliminação da conta ou do evento. Uma falha ao escrever
auditoria não bloqueia a operação de negócio e é registada no log
interno.

Falta decidir: política de retenção dos próprios registos de auditoria
e exposição futura (endpoint de consulta).

## 16. Callbacks do provider de email

- Endpoint de webhook assinado pelo provider.
- Processa `delivered`, `bounced` e `complained`.
- Bounces permanentes e reclamações originam supressão do endereço
  para novos envios.
- O webhook é idempotente e valida a assinatura antes de alterar
  estado.
- Falta implementar: rota, verificação de assinatura, mapeamento para
  `email_deliveries` e tabela de supressão.

## 17. Templates finais

Dependência externa: os templates visuais, os campos suportados e os
limites de acessibilidade são fornecidos pelo responsável do produto.
A infraestrutura actual (`event_templates` e template neutro `base`)
mantém-se como ponto de extensão.

## 18. Email assíncrono — outbox e worker dedicado

- Nenhum pedido HTTP envia email. Tudo o que sai (convites, lembretes,
  avisos, OTP, verificação, reposição de senha, boas-vindas e link de
  gestão) é escrito na outbox `email_deliveries` dentro da transacção de
  negócio.
- O worker corre em processo próprio (`npm run worker`, ou
  `npm run worker:start` sobre `dist/worker.js`) e pode ser escalado
  horizontalmente. `FOR UPDATE SKIP LOCKED` impede entregas duplicadas
  entre instâncias.
- Em protótipos com um só serviço, `OUTBOX_IN_API=true` mantém o
  agendador dentro da API. Em produção recomenda-se
  `OUTBOX_IN_API=false` para que o envio não dispute o event loop nem as
  ligações à base de dados com os pedidos HTTP.
- `pg_notify('outbox_new')` acorda os workers logo após o commit; o
  polling (`OUTBOX_SCAN_INTERVAL_MS`) continua como fallback para
  lembretes agendados e notificações perdidas.
- Retries com backoff exponencial (`EMAIL_MAX_ATTEMPTS`,
  `EMAIL_RETRY_BASE_MS`) e recuperação de linhas presas em `processing`.
- O link de gestão passou a ser enfileirado: o token é guardado cifrado
  em `token_encrypted` até à renderização. A resposta usa
  `manage_email_status: queued | failed`, não o resultado do fornecedor.
- Não é introduzida uma fila externa (Redis/SQS): a outbox transaccional
  em PostgreSQL garante durabilidade e idempotência sem mais um serviço
  para operar.

## 19. Link de convite para partilha manual (WhatsApp)

- A `Invitation` devolvida ao anfitrião (lista por evento, lista global
  e detalhe) inclui `invitation_url` (URL absoluto para
  `<APP_BASE_URL>/convite/<token>`) e `invitation_url_expires_at`.
- É o mesmo token do email; não é de uso único e não expira. O primeiro
  navegador que abre o link reivindica o convite com um cookie; os
  restantes precisam desse cookie.
- O anfitrião deve copiar/partilhar o URL, não o abrir — ao abri-lo,
  reivindica o convite para o seu próprio navegador.
- `resend` mantém o token; `revoke` invalida-o para sempre e a API passa
  a devolver `invitation_url: null`.
- As respostas públicas nunca incluem o campo. O logger redige
  `invitation_url`/`invitationUrl`.
- Nesta fase não há rotação de token de convite. Se for necessária
  (por exemplo, para recuperar de um claim indevido), terá de ser
  adicionada explicitamente com nova chave idempotente e reset de
  `claim_hash`.

## 20. "Meus convites" — conta convidada (opção A)

- `GET /api/v1/host/invitations` devolve os convites dirigidos ao email
  da conta autenticada. A rota usa apenas `accountSession`; não aceita a
  sessão de gestão de um evento.
- Associação escolhida: **opção A** — `invitations.guest_email` =
  `hosts.email`, comparado sem distinguir maiúsculas/minúsculas
  (`lower()` nos dois lados). Não há coluna nova, migração nem impacto
  nos convites existentes.
- Só contas com email verificado podem consultar (`403
  email_not_verified`). Sem esta barreira, alguém poderia registar o
  email de outra pessoa e reclamar os convites antes do dono.
- A associação é dinâmica: convites anteriores à conta aparecem assim
  que o email é verificado; se a conta mudar de email, deixa de ver os
  convites do email antigo (voltar atrás faz reaparecer).
- Convites revogados são excluídos. Eventos cancelados/concluídos
  aparecem com o `event.status`, para o convidado perceber que já não se
  realiza ou já passou.
- A resposta expõe apenas o próprio convite (RSVP, mesa, `created_at`,
  `invitation_url`) e um resumo público do evento (título, anfitrião,
  data, fuso, estado, categoria, template, local). Nunca outros
  convidados, contagens, contribuições/banca, notas privadas,
  `host_email` ou estatísticas.
- `invitation_url` é o mesmo link do email; o convidado pode abri-lo.
  Não expira nesta fase e é `null` se o token não puder ser reconstruído.
- A opção B (FK explícita `account_id` no convite) fica reservada para
  quando for necessário preservar o histórico após mudança de email ou
  impedir que um email reutilizado veja convites antigos.

## 21. Notificações in-app

- Nova tabela `host_notifications`, por conta, separada do feed
  append-only `event_activity`.
- O sino da navbar abre um modal com lembretes e últimas actividades;
  “ver tudo” abre a página de notificações com pesquisa, filtros
  (`status`, `kind`, `event_id`), paginação, marcar como lida,
  remover e limpar tudo.
- Os lembretes (`event_upcoming`, `rsvp_deadline`) são sincronizados na
  leitura e deduplicados por `dedupe_key`.
- Remover uma notificação é lógico (`dismissed_at`) e não toca no
  histórico do evento.

## 22. Tarefas por evento e por gestor

- `host_tasks` ganhou `manager_id` e `completed_at`; uma tarefa de
  gestor exige `event_id`.
- O anfitrião cria tarefas próprias ou para gestores de um evento; os
  gestores vêem apenas as que lhes foram atribuídas e só marcam
  `done`.
- A página global `/tarefas` pagina, filtra (`status`, `assignee`,
  `manager_id`, `event_id`) e pesquisa; o detalhe do evento mostra as
  tarefas desse evento.

## 23. Capa do evento

- `events.cover_url` é a imagem apresentada no evento e no convite.
- Pode ser definida por URL ou por upload (`multipart/form-data`).
- O upload é idempotente por SHA-256 (`cover_hash`) e o asset antigo é
  removido do Cloudinary ao substituir/remover (`cover_public_id`).
- O frontend deve mostrar progresso e permitir cancelar o upload.

## 24. Convite acessível em qualquer navegador

- Além da capacidade do navegador, o convite aceita uma sessão de conta
  cujo email verificado coincide com `invitations.guest_email`.
- O `PublicInvitation` expõe `guest.email` e `guest.email_has_account`
  para o frontend sugerir entrar ou criar conta.
- O `claim_hash` original não é alterado quando a conta abre o convite
  noutro navegador; ambos os acessos coexistem.
- Sem conta correspondente, a resposta continua a ser o `404`
  genérico.
