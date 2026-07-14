#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ "${CONFIRM_RESTORE:-}" != "RESTORE_MENTOR_AI" ]; then
  echo "Usage: CONFIRM_RESTORE=RESTORE_MENTOR_AI $0 backups/file.sql.gz" >&2
  exit 2
fi
FILE="$1"
test -f "$FILE"
gzip -t "$FILE"
gunzip -c "$FILE" | docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'
echo "Restore completed from $FILE"
