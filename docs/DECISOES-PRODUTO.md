# Decisões de produto fechadas

Registo das decisões do responsável do produto que estavam em aberto.
Cada decisão indica o estado face à implementação actual. Quando a
implementação ainda não existe, o comportamento descrito é o alvo a
seguir; não deve ser assumido como já disponível.

Data de fecho: 2026-11-15.

| # | Tema | Decisão | Estado |
|---|---|---|---|
| 1 | Contas de anfitrião | Introduzir contas com email e senha, mantendo o link secreto por evento | Implementado |
| 2 | Verificação de email | Obrigatória para criar/gerir eventos; login permitido antes | Implementado |
| 3 | Data de nascimento | Opcional e não bloqueante, `YYYY-MM-DD`, passado, idade mínima 18 | Implementado |
| 4 | Categoria e mesas | Manter `events.category` e `invitations.table_name` | Implementado |
| 5 | Claim automático | Ligar eventos legados à conta após verificação do email | Implementado |
| 6 | Link de gestão | Continua a ser enviado por email ao criar evento com conta | Implementado |
| 7 | Retenção de conta | Apagar conta inativa após 24 meses sem login | Pendente |
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

## 1. Contas de anfitrião

Contas aprovadas. O fluxo legado por link secreto mantém-se válido em
paralelo; nenhuma rota antiga é removida por causa das contas.

## 2. Verificação de email

- `POST /auth/register` cria a conta por verificar e não inicia sessão.
- O login é permitido antes da verificação.
- Criar, apagar ou gerir eventos exige email verificado
  (`403 email_not_verified`).
- A verificação liga automaticamente eventos legados com o mesmo
  `host_email` à conta, de forma idempotente.

## 3. Data de nascimento

- Campo opcional `host_profiles.birth_date`, data de calendário
  `YYYY-MM-DD`, no passado.
- Idade mínima `MIN_HOST_AGE_YEARS` (por omissão 18).
- A ausência não bloqueia a conta; apenas faz `profile_complete=false`
  e acrescenta `birth_date` a `missing_fields`.

## 4. Categoria e mesas

- `events.category`: `wedding`, `birthday`, `corporate`, `baby`,
  `other`; opcional.
- `invitations.table_name`: texto opcional, visível apenas ao
  anfitrião; não é exposto na página pública do convite.

## 5. Claim automático de eventos legados

Ao consumir a verificação de email, os eventos com `host_email` igual
ao email verificado e `host_id` nulo passam a pertencer à conta. A
operação é idempotente e só ocorre depois da verificação.

## 6. Link de gestão ao criar evento com conta

`POST /host/events` continua a enviar o link de gestão para
`host_email`, tal como `POST /events`. O envelope mantém
`manage_email_status` e `deliveries`.

## 7. Retenção de conta — 24 meses

- Uma conta sem login durante 24 meses é apagada.
- A eliminação remove perfil, sessões, tokens, tarefas e entregas de
  email da conta.
- Os eventos ficam com `host_id` nulo (`ON DELETE SET NULL`); não são
  apagados automaticamente pelo processo de retenção.
- O processo deve ser idempotente e registar apenas contagens, nunca
  PII.
- Falta implementar: tarefa agendada/operacional e métrica de execução.

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
