# Migração de equipas e tarefas (Prompt 5)

Migrações:

- [`../migrations/1739900000011_teams.js`](../migrations/1739900000011_teams.js)
- [`../migrations/1739900000012_team-task-indexes.js`](../migrations/1739900000012_team-task-indexes.js)
- [`../migrations/1739900000013_team-notifications.js`](../migrations/1739900000013_team-notifications.js)
- [`../migrations/1739900000014_team-invite-blocks.js`](../migrations/1739900000014_team-invite-blocks.js)

## O que faz

- Cria `teams` e `team_members` (ver [`DATA-MODEL.md`](DATA-MODEL.md)).
- Acrescenta a `host_tasks`: `team_id`, `assignee_member_id`, `title`,
  `description`, `due_date`, `priority`, `status`, `created_by_host_id`,
  `completed_by_member_id` e `archived_at`.
- A migração seguinte,
  [`1739900000012_team-task-indexes.js`](../migrations/1739900000012_team-task-indexes.js),
  cria os índices parciais `(team_id, status)`, `(assignee_member_id,
  status)` e `archived_at`. Usa `CREATE INDEX CONCURRENTLY` fora de
  transação (`pgm.noTransaction()`), para não bloquear escritas em
  `host_tasks` em produção; o `down` remove-os com
  `DROP INDEX CONCURRENTLY`.
- A migração da Fase 3,
  [`1739900000013_team-notifications.js`](../migrations/1739900000013_team-notifications.js),
  acrescenta `payload jsonb` a `email_deliveries`, alarga
  `email_deliveries_type_check` e `host_notifications_kind_check`, e cria
  `team_invites` (HMAC do token, expiração, aceitação, revogação e
  contadores anti-spam). O `down` apaga as linhas dos tipos novos antes
  de restaurar as constraints antigas, pelo que é reversível mesmo com
  dados gerados.
- A migração
  [`1739900000014_team-invite-blocks.js`](../migrations/1739900000014_team-invite-blocks.js)
  acrescenta `created_by_host_id` a `team_invites` (remetente original),
  cria `team_invite_blocks` (par anfitrião + email denunciado) e alinha
  as constraints com o catálogo final: entram `team_added` e
  `team_role_changed`, sai `member_removed`. O `down` repõe as
  constraints da migração 13 e remove a tabela/coluna.
- Cria a equipa **"Geral"** (categoria `outra`) por cada evento com
  tarefas antigas **e com pelo menos um responsável possível**
  (anfitrião ou gestor activo).
- Materializa o anfitrião e os gestores activos como membros dessa
  equipa; gestores revogados que ainda sejam responsáveis ficam como
  membros removidos, para preservar a FK e o histórico.
- Move as tarefas antigas para a "Geral" e define o responsável:
  gestor antigo, se existir; senão o anfitrião; senão o primeiro gestor
  activo.
- Tarefas sem evento **ou sem responsável possível** ficam com
  `team_id = NULL` e continuam visíveis na secção **"Pessoais
  (legado)"** do criador, com a ação "Mover para uma equipa".
- O evento de uma tarefa passa a ser derivado da equipa por trigger
  (`host_tasks_sync_team_event`); tentar mudar de evento é rejeitado.
- `CHECK host_tasks_team_assignee_check`: uma tarefa com `team_id`
  **tem sempre** `assignee_member_id`.
- `completed_by_member_id` das tarefas antigas concluídas é o
  **responsável** da tarefa (o gestor, quando era ele), nunca
  automaticamente o anfitrião.

## Compatibilidade durante o deploy

O código antigo só conhece `label`, `done` e `manager_id`. Depois da
migração continua a funcionar sem alterações:

| Coluna | Nulável | Default | Preenchimento |
|---|---|---|---|
| `team_id` | sim | — | nulo = tarefa pessoal/legada |
| `assignee_member_id` | sim | — | obrigatório quando `team_id` existe |
| `title` | não | — | trigger copia de `label` |
| `description` | sim | — | — |
| `due_date` | sim | — | — |
| `priority` | não | `'normal'` | default |
| `status` | não | `'por_fazer'` | trigger sincroniza com `done` |
| `created_by_host_id` | não | — | trigger copia de `host_id` |
| `completed_by_member_id` | sim | — | definido pelo serviço ao concluir; o trigger não infere o autor |
| `archived_at` | sim | — | preenchido ao arquivar a tarefa |
| `label` / `done` / `manager_id` | como antes | como antes | mantidos |

Triggers de transição:

- `host_tasks_sync_legacy_columns` mantém `label`↔`title` e
  `done`↔`status` sincronizados em insert e update, preenche
  `created_by_host_id` e `completed_at`, e limpa `completed_at` e
  `completed_by_member_id` quando a tarefa volta a `por_fazer`. O
  trigger **nunca** decide quem concluiu: `completed_by_member_id` é
  definido pelo serviço depois de validar que a conta é o responsável.
- `host_tasks_sync_team_event` garante que `event_id` é o evento da
  equipa.

Provas automatizadas em `tests/teamsMigration.test.ts`:

1. inserir uma tarefa **só com `label`** → `title`, `status`,
   `priority` e `created_by_host_id` ficam corretos;
2. atualizar `label` → `title` acompanha;
3. alternar `done = true` → `status = concluida` e `completed_at`
   preenchido, mas `completed_by_member_id` **continua nulo** (o
   trigger não inventa o autor); um valor explícito definido pelo
   serviço é preservado;
4. alternar `done = false` → `status = por_fazer`, `completed_at` e
   `completed_by_member_id` ficam nulos.

Os triggers mantêm-se durante toda a transição da Fase 2; só serão
removidos quando o código antigo (frontend incluído) deixar de ler
`label`/`done`/`manager_id`, numa fase posterior.

## Testar numa cópia (obrigatório antes de aplicar)

```bash
./scripts/teams-migration-check.sh
```

O script:

1. arranca o Postgres de teste do `docker-compose` (porta 5433);
2. recria a base `apupu_cc5_copy` a partir de `DATABASE_URL` do `.env`;
3. carrega `tests/fixtures/teams-migration.sql`;
4. mostra contagens antes;
5. aplica as migrations;
6. corre `tests/teamsMigration.test.ts` (invariantes de `up`);
7. reverte com `down 4` (bloqueios + notificações + índices + equipas);
8. mostra contagens e corre os invariantes de `down`.

Nunca escreve na base de origem. Para apontar a outra origem:

```bash
SOURCE_URL=postgres://... ./scripts/teams-migration-check.sh
```

### Usar um dump de produção (sem ligar à produção)

O script **não** se liga a produção. Para validar com dados reais:

```bash
# 1. Restaurar o dump numa instância separada (nunca na produção)
pg_restore --clean --if-exists -d "postgres://user:pass@instancia-separada:5432/apupu_copia" producao.dump

# 2. Validar contra essa instância restaurada
SOURCE_URL="postgres://user:pass@instancia-separada:5432/apupu_copia" \
ALLOW_REMOTE_SOURCE=1 \
./scripts/teams-migration-check.sh
```

Sem `ALLOW_REMOTE_SOURCE=1`, o script recusa qualquer `SOURCE_URL` que
não seja `localhost`/`127.0.0.1`. A origem é apenas lida por `pg_dump`;
todas as escritas acontecem na cópia local (`apupu_cc5_copy`).

### Resultado da última execução (cópia local)

| Métrica | Antes | Depois | Depois do rollback |
|---|---:|---:|---:|
| eventos | 9 | 9 | 9 |
| contas | 10 | 10 | 10 |
| gestores | 5 | 5 | 5 |
| tarefas | 9 | 9 | 9 |
| tarefas sem evento | 1 | 1 | 1 |
| tarefas concluídas | 2 | 2 | 2 |
| equipas | — | 4 | — |
| membros | — | 6 | — |
| tarefas com equipa | — | 7 | — |
| tarefas com responsável | — | 7 | — |
| tarefas pessoais | — | 2 | — |

Testes: **18 passed / 0 skipped** (`up`) e **4 passed / 0 skipped**
(`down`). Cada execução regista apenas a direcção que está a validar,
por isso não há testes ignorados. `npm run test:teams` cobre também os
testes da API e da Fase 3 (53 passed na API).

Para repetir a validação da API e da migração numa base limpa:

```bash
npm run test:teams
```

## Aplicar na base real

> Só depois de a cópia passar e com backup verificado.

```bash
# 1. Backup lógico comprimido
pg_dump "$DATABASE_URL" -Fc -f "backup-pre-equipas-$(date +%Y%m%d-%H%M).dump"

# 2. Verificar que o backup abre
pg_restore --list "backup-pre-equipas-YYYYMMDD-HHMM.dump" >/dev/null

# 3. Aplicar
npm run migrate:up
```

## Rollback

```bash
# Reverter as quatro migrações de equipas
# (bloqueios + notificações + índices + tabelas/colunas)
npx node-pg-migrate down 4

# Restaurar o backup completo (destrutivo: substitui a base)
pg_restore --clean --if-exists -d "$DATABASE_URL" backup-pre-equipas-YYYYMMDD-HHMM.dump
```

O `down` reconstrói `done`, `completed_at` e `manager_id` a partir das
colunas novas antes de as remover, pelo que nenhuma tarefa é perdida.

## Notas

- A remoção de equipas é lógica (`deleted_at`) e a de membros também
  (`removed_at`); não há `DELETE` em cascata de tarefas.
- O índice único de nome de equipa ignora equipas apagadas e compara o
  nome sem espaços nas pontas e sem distinguir maiúsculas.
- `host_tasks.event_id` continua a existir para compatibilidade, mas é
  sempre sincronizado com `teams.event_id`.
- `team_materialize_event_staff(team_id)` materializa anfitrião e
  gestores activos numa equipa. A Fase 2 chama-a na mesma transação que
  cria a equipa ou altera o acesso de um gestor.
- A Fase 3 não altera tabelas existentes além de `email_deliveries` e
  `host_notifications` (coluna e constraints). `team_invites` e
  `team_invite_blocks` são novas; os convites guardam só o HMAC do
  token, e o token em claro fica no email cifrado da outbox.
- Nenhum serviço envia email directamente: convites, adições,
  alterações de papel, atribuições, conclusões e reatribuições passam
  sempre pela outbox, com retries e supressão quando a mensagem deixa de
  fazer sentido. A remoção de um membro é silenciosa: não gera email
  nem notificação.
