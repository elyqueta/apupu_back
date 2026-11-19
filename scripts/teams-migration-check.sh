#!/usr/bin/env bash
#
# Valida a migração de equipas/tarefas numa CÓPIA da base de dados.
#
# Nunca escreve na base de origem: o dump é restaurado num Postgres
# efémero do docker-compose (porta 5433), onde o fixture e a migração
# correm. No fim mostra contagens antes/depois e testa o rollback.
#
# Uso:
#   scripts/teams-migration-check.sh
#
# Variáveis opcionais:
#   SOURCE_URL  base de dados de origem (por omissão, DATABASE_URL do .env)
#   COPY_DB     nome da base de dados de teste (por omissão apupu_cc5_copy)
#
set -euo pipefail
cd "$(dirname "$0")/.."

COPY_DB="${COPY_DB:-apupu_cc5_copy}"
DEST_ADMIN="postgres://apupu_user:apupu_password@localhost:5433/postgres"
DEST_URL="postgres://apupu_user:apupu_password@localhost:5433/${COPY_DB}"
SOURCE_URL="${SOURCE_URL:-$(node -e "require('dotenv').config({quiet:true});process.stdout.write(process.env.DATABASE_URL)")}"

if [[ "$SOURCE_URL" == *"localhost:5433"* || "$SOURCE_URL" == *"127.0.0.1:5433"* ]]; then
  echo "A origem já aponta para a base de teste. Aborta para não fazer dump de si própria." >&2
  exit 1
fi

# O script nunca deve apontar diretamente para produção. Para usar um
# dump de produção, restaura-o primeiro numa instância separada e
# autoriza explicitamente essa origem com ALLOW_REMOTE_SOURCE=1.
if [[ "${ALLOW_REMOTE_SOURCE:-0}" != "1" ]]; then
  case "$SOURCE_URL" in
    *localhost*|*127.0.0.1*) ;;
    *)
      echo "SOURCE_URL não é local. Restaura o dump numa instância separada e usa ALLOW_REMOTE_SOURCE=1." >&2
      exit 1
      ;;
  esac
fi

echo "== 1/8 A arrancar o Postgres de teste (5433) =="
docker compose up -d postgres >/dev/null
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5433 -U apupu_user >/dev/null 2>&1; then break; fi
  sleep 1
done
pg_isready -h localhost -p 5433 -U apupu_user >/dev/null

echo "== 2/8 A recriar a cópia ${COPY_DB} =="
psql "$DEST_ADMIN" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS ${COPY_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${COPY_DB};"

echo "== 3/8 A copiar schema e dados da origem =="
pg_dump "$SOURCE_URL" --no-owner --no-privileges \
  | sed '/^SET transaction_timeout = 0;$/d' \
  | psql "$DEST_URL" -v ON_ERROR_STOP=1 -q

echo "== 4/8 A carregar o fixture =="
psql "$DEST_URL" -v ON_ERROR_STOP=1 -q -f tests/fixtures/teams-migration.sql

counts() {
  psql "$DEST_URL" -v ON_ERROR_STOP=1 -P pager=off -c "
    SELECT
      (SELECT count(*) FROM events) AS eventos,
      (SELECT count(*) FROM hosts) AS contas,
      (SELECT count(*) FROM event_managers) AS gestores,
      (SELECT count(*) FROM host_tasks) AS tarefas,
      (SELECT count(*) FROM host_tasks WHERE event_id IS NULL) AS tarefas_sem_evento,
      (SELECT count(*) FROM host_tasks WHERE done) AS tarefas_concluidas,
      to_regclass('public.teams') IS NOT NULL AS tem_equipas,
      to_regclass('public.team_members') IS NOT NULL AS tem_membros;"
}

echo
echo "== 5/8 Contagens ANTES da migração =="
counts

echo
echo "== 6/8 A aplicar migrations (up) =="
DATABASE_URL="$DEST_URL" npx node-pg-migrate up --verbose=false

echo
echo "== Contagens DEPOIS da migração =="
psql "$DEST_URL" -v ON_ERROR_STOP=1 -P pager=off -c "
  SELECT
    (SELECT count(*) FROM teams) AS equipas,
    (SELECT count(*) FROM teams WHERE name = 'Geral') AS equipas_geral,
    (SELECT count(*) FROM team_members) AS membros,
    (SELECT count(*) FROM team_members WHERE is_host) AS anfitrioes,
    (SELECT count(*) FROM team_members WHERE removed_at IS NOT NULL) AS membros_removidos,
    (SELECT count(*) FROM host_tasks) AS tarefas,
    (SELECT count(*) FROM host_tasks WHERE team_id IS NOT NULL) AS tarefas_com_equipa,
    (SELECT count(*) FROM host_tasks WHERE assignee_member_id IS NOT NULL) AS tarefas_com_responsavel,
    (SELECT count(*) FROM host_tasks WHERE team_id IS NULL) AS tarefas_pessoais;"

echo
echo "== Testes de invariantes (up) =="
TEAMS_MIGRATION_TEST_URL="$DEST_URL" npx vitest run tests/teamsMigration.test.ts

echo
echo "== 7/8 A reverter (down) =="
DATABASE_URL="$DEST_URL" npx node-pg-migrate down 2 --verbose=false

echo
echo "== Contagens DEPOIS do rollback =="
counts

echo
echo "== Testes de invariantes (down) =="
TEAMS_MIGRATION_TEST_URL="$DEST_URL" TEAMS_MIGRATION_EXPECT=down \
  npx vitest run tests/teamsMigration.test.ts

echo
echo "== 8/8 Concluído. Cópia preservada em ${COPY_DB} (porta 5433). =="
