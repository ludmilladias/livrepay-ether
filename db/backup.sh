#!/usr/bin/env bash
# Backup do Postgres do LIVREPAY — sistema fintech, sem backup automatizado
# até 2026-08-20 (ver diagnóstico do DevOps em SECURITY.md).
#
# Uso:
#   bash db/backup.sh                    # dump para db/backups/<timestamp>.sql.gz
#   bash db/backup.sh --restore ARQUIVO  # restaura um dump (destrutivo — confirma antes)
#
# Lê as mesmas variáveis do docker-compose.yml (.env na raiz). Roda contra o
# container `livrepay-novo-db` por padrão — ajuste CONTAINER se o nome mudar.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${LIVREPAY_DB_CONTAINER:-livrepay-novo-db}"
BACKUP_DIR="${LIVREPAY_BACKUP_DIR:-$ROOT/db/backups}"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env"
  set +a
fi

POSTGRES_DB="${POSTGRES_DB:-livrepay}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

mkdir -p "$BACKUP_DIR"

restore() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Arquivo de backup não encontrado: $file" >&2
    exit 1
  fi

  echo "!! Isto SOBRESCREVE o banco '$POSTGRES_DB' no container '$CONTAINER'."
  read -r -p "Digite 'restaurar' para confirmar: " confirm
  if [ "$confirm" != "restaurar" ]; then
    echo "Cancelado."
    exit 1
  fi

  echo "==> Restaurando $file"
  gunzip -c "$file" | docker exec -i "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1
  echo "==> Restauração concluída"
}

backup() {
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local out="$BACKUP_DIR/livrepay_${stamp}.sql.gz"

  echo "==> Gerando dump de '$POSTGRES_DB' no container '$CONTAINER'"
  docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --format=plain \
    | gzip > "$out"

  echo "==> Backup salvo em $out ($(du -h "$out" | cut -f1))"
  echo "==> Teste de restauração: rode 'bash db/backup.sh --restore $out' contra um banco descartável"
  echo "    antes de confiar neste arquivo. Um backup nunca testado não é um backup."
}

if [ "${1:-}" = "--restore" ]; then
  restore "${2:?uso: db/backup.sh --restore ARQUIVO.sql.gz}"
else
  backup
fi
