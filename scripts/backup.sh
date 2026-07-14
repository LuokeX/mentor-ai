#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/mentor-ai-$(date +%Y%m%d-%H%M%S).sql.gz"
RAW_FILE="$BACKUP_DIR/.mentor-ai-backup-$$.sql"
COMPRESSED_FILE="$FILE.tmp"
trap 'rm -f "$RAW_FILE" "$COMPRESSED_FILE"' EXIT HUP INT TERM
docker compose exec -T postgres sh -c 'exec pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$RAW_FILE"
gzip -9 -c "$RAW_FILE" > "$COMPRESSED_FILE"
mv "$COMPRESSED_FILE" "$FILE"
chmod 600 "$FILE"
find "$BACKUP_DIR" -type f -name 'mentor-ai-*.sql.gz' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
rm -f "$RAW_FILE"
trap - EXIT HUP INT TERM
echo "Backup written to $FILE"
