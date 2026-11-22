#!/usr/bin/env bash
# Restores an encrypted backup into a SCRATCH database and proves it is usable. It never touches
# the live database. Run it once before the demo (Master Plan section 4): a backup that has never
# been restored is a hope, not a backup.
#
# Usage:
#   restore.sh /opt/uposhom/backups/uposhom-20261122T200000Z.dump.enc
#   restore.sh r2:backups/uposhom-20261122T200000Z.dump.enc        (download from R2 first)
#
# It creates database "uposhom_restore_check", restores into it, prints row counts for the key
# tables, then drops it. Set KEEP=1 to leave it in place for a closer look.
set -euo pipefail

SRC="${1:-}"
[ -n "$SRC" ] || { echo "usage: $0 <backup.dump.enc | r2:backups/<file>>" >&2; exit 2; }

ROOT="${UPOSHOM_DIR:-/opt/uposhom}"
PASS_FILE="${BACKUP_PASS_FILE:-$ROOT/backup.pass}"
ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/backup.env}"
PG_CONTAINER="${PG_CONTAINER:-uposhom-postgres}"
SCRATCH="${SCRATCH_DB:-uposhom_restore_check}"
log() { echo "$(date -u +%FT%TZ) restore: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

if [ -z "${PG_USER:-}" ]; then
  [ -f "$ROOT/.env" ] || die "no $ROOT/.env and PG_USER not set"
  PG_USER="$(grep -E '^POSTGRES_USER=' "$ROOT/.env" | cut -d= -f2-)"
fi
[ -s "$PASS_FILE" ] || die "missing or empty passphrase file $PASS_FILE"

FILE="$SRC"
CLEANUP=""
if [[ "$SRC" == r2:* ]]; then
  [ -f "$ENV_FILE" ] || die "missing $ENV_FILE (R2 credentials)"
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
  FILE="$(mktemp)"
  CLEANUP="$FILE"
  log "downloading $SRC"
  rclone copyto "r2:$R2_BUCKET/${SRC#r2:}" "$FILE"
fi
[ -s "$FILE" ] || die "$FILE is missing or empty"
trap '[ -n "$CLEANUP" ] && rm -f "$CLEANUP"; [ "${KEEP:-0}" = "1" ] || docker exec "$PG_CONTAINER" dropdb -U "$PG_USER" --if-exists "$SCRATCH" >/dev/null 2>&1 || true' EXIT

psql_scratch() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$SCRATCH" -At -v ON_ERROR_STOP=1 "$@"; }

log "creating scratch database $SCRATCH"
docker exec "$PG_CONTAINER" dropdb -U "$PG_USER" --if-exists "$SCRATCH"
docker exec "$PG_CONTAINER" createdb -U "$PG_USER" "$SCRATCH"

log "decrypting and restoring"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$FILE" \
  | docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$SCRATCH" --no-owner --exit-on-error \
  || die "decrypt or restore failed (wrong passphrase, or a damaged backup)"

log "row counts in the restored copy:"
tables="$(psql_scratch -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1")"
[ -n "$tables" ] || die "the restore produced no tables"
for t in $tables; do
  printf '  %-28s %s\n' "$t" "$(psql_scratch -c "SELECT count(*) FROM \"$t\"")"
done
log "OK: the backup restores. Dropping the scratch database."
