#!/usr/bin/env bash
#
# Testes de integração das equipas/tarefas (Fases 2 e 3).
#
# Sobe o Postgres de teste do docker-compose (porta 5433), recria duas
# bases efémeras e corre:
#   1. a API contra `apupu_teams_api` (schema completo);
#   2. a migração contra `apupu_teams_migration` (schema anterior à
#      migração de equipas + fixture), validando `up` e `down 4`.
#
# Nunca toca na base de desenvolvimento (5432): todos os URLs usados
# aqui apontam para 5433.
#
# Uso:
#   npm run test:teams
#
set -euo pipefail
cd "$(dirname "$0")/.."

API_DB="${TEAMS_API_DB:-apupu_teams_api}"
MIGRATION_DB="${TEAMS_MIGRATION_DB:-apupu_teams_migration}"
ADMIN_URL="postgres://apupu_user:apupu_password@localhost:5433/postgres"
API_URL="postgres://apupu_user:apupu_password@localhost:5433/${API_DB}"
MIGRATION_URL="postgres://apupu_user:apupu_password@localhost:5433/${MIGRATION_DB}"

echo "== 1/6 A arrancar o Postgres de teste (5433) =="
docker compose up -d postgres >/dev/null

for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5433 -U apupu_user >/dev/null 2>&1; then break; fi
  sleep 1
done
pg_isready -h localhost -p 5433 -U apupu_user >/dev/null

echo "== 2/6 A recriar ${API_DB} e ${MIGRATION_DB} =="
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS ${API_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${API_DB};" \
  -c "DROP DATABASE IF EXISTS ${MIGRATION_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${MIGRATION_DB};"

echo "== 3/6 A aplicar todas as migrations na base da API =="
DATABASE_URL="$API_URL" npx node-pg-migrate up --verbose=false

echo "== 4/6 Testes da API (equipas, membros, tarefas, convites e notificações) =="
# Sem paralelismo entre ficheiros: os testes de outbox processam todas as
# entregas vencidas da base e precisam de isolamento entre ficheiros.
TEAMS_API_TEST_URL="$API_URL" npx vitest run --no-file-parallelism \
  tests/teamsPhase3Unit.test.ts \
  tests/teamsApi.test.ts \
  tests/teamsApiPhase2Corrections.test.ts \
  tests/teamsPhase3.test.ts \
  tests/teamsPhase3Corrections.test.ts

echo "== 5/6 Migração: estado anterior + fixture + up =="
DATABASE_URL="$MIGRATION_URL" npx node-pg-migrate up 11 --verbose=false
psql "$MIGRATION_URL" -v ON_ERROR_STOP=1 -q -f tests/fixtures/teams-migration.sql
DATABASE_URL="$MIGRATION_URL" npx node-pg-migrate up --verbose=false

TEAMS_MIGRATION_TEST_URL="$MIGRATION_URL" npx vitest run tests/teamsMigration.test.ts

echo "== 6/6 Migração: down 4 e validação do rollback =="
DATABASE_URL="$MIGRATION_URL" npx node-pg-migrate down 4 --verbose=false
TEAMS_MIGRATION_TEST_URL="$MIGRATION_URL" TEAMS_MIGRATION_EXPECT=down \
  npx vitest run tests/teamsMigration.test.ts

echo
echo "Concluído: API e migração validados em cópias locais (porta 5433)."
