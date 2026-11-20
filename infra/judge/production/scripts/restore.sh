#!/usr/bin/env bash
# Restores a Judge0 database backup into the running stack. Stops server/workers first so no
# job is processed against a half-restored database. Usage: ./scripts/restore.sh <file.sql.gz>
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?backup file}"
sha256sum -c "$file.sha256"
read -r -p "This replaces the Judge0 database contents. Type RESTORE to continue: " ok
[[ "$ok" == "RESTORE" ]] || { echo "Aborted"; exit 1; }
docker compose stop server worker
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gunzip -c "$file" | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose up -d --wait server worker
echo "Restore complete. Run ./scripts/verify-isolation.sh before re-enabling execution."
