#!/usr/bin/env bash
# Logical backup of the Judge0 database (submissions metadata only; the platform database is the
# system of record for grades). Usage: ./scripts/backup.sh /var/backups/judge0
set -euo pipefail
cd "$(dirname "$0")/.."
dest="${1:?backup directory}"
mkdir -p "$dest"; chmod 700 "$dest"
file="$dest/judge0-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip -9 > "$file"
gzip -t "$file"
sha256sum "$file" > "$file.sha256"
echo "Backup written: $file"
