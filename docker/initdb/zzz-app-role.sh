#!/bin/bash
# Cria a role de login da API após as migrations.
# O prefixo "zzz" garante que rode por último no /docker-entrypoint-initdb.d.
#
# Esta role NÃO é dona das tabelas — é isso que faz a RLS valer para a API.
# (Dono de tabela ignora policies por padrão no Postgres.)
set -euo pipefail

: "${APP_DB_USER:?APP_DB_USER não definido}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD não definido}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER}') THEN
      CREATE ROLE ${APP_DB_USER} LOGIN NOINHERIT PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  GRANT authenticated, service_role TO ${APP_DB_USER};
  GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};
EOSQL

echo "Role de aplicação ${APP_DB_USER} pronta."
