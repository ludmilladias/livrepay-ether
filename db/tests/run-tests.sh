#!/usr/bin/env bash
# Testes de segurança do schema LIVREPAY.
# Sobe um Postgres 16 descartável, aplica a migration e roda as asserções.
# Uso:  bash db/tests/run-tests.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash no Windows não deve converter /tmp

CONTAINER="livrepay-migration-test"
PORT="${PGTEST_PORT:-5435}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# No Git Bash o caminho é /c/Users/...; o docker precisa de C:\Users\...
hostpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

echo "==> Subindo Postgres de teste na porta $PORT"
cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -p "$PORT:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Copiando scripts"
docker cp "$(hostpath "$ROOT/db/tests/security_test.sql")" "$CONTAINER:/tmp/security_test.sql"

# Aplica todas as migrations em ordem cronológica.
i=0
for migration in "$ROOT"/db/migrations/*.sql; do
  docker cp "$(hostpath "$migration")" "$CONTAINER:/tmp/migration_$i.sql"
  i=$((i + 1))
done

echo "==> Aplicando migrations ($i)"
for n in $(seq 0 $((i - 1))); do
  docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/migration_$n.sql"
done

echo "==> Rodando testes de segurança"
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/security_test.sql

echo "==> OK"
