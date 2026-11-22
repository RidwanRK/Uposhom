#!/usr/bin/env bash
# Nightly Postgres backup: pg_dump, encrypt (AES-256), upload to Cloudflare R2, prune old copies.
# Runs on the VM from cron (see deploy/README.md). The only copy of the data is otherwise the VM
# disk, so this is what stands between a dead VM and losing every account, charge and consent.
#
# Needs, on the VM:
#   - /opt/uposhom/backup.pass   the encryption passphrase, chmod 600, NOT in the repo. Keep a
#                                copy in the password manager: a backup nobody can decrypt is
#                                worth nothing.
#   - /opt/uposhom/backup.env    chmod 600, holds the R2 credentials (see backup.env.example)
#   - rclone                     sudo apt install rclone
#
# Usage:
#   backup.sh                 dump, encrypt, upload, prune
#   backup.sh --local-only    dump and encrypt into $BACKUP_DIR, skip the upload (testing)
set -euo pipefail

ROOT="${UPOSHOM_DIR:-/opt/uposhom}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
PASS_FILE="${BACKUP_PASS_FILE:-$ROOT/backup.pass}"
ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/backup.env}"
PG_CONTAINER="${PG_CONTAINER:-uposhom-postgres}"
KEEP_DAYS="${KEEP_DAYS:-14}"
LOCAL_ONLY=0
[ "${1:-}" = "--local-only" ] && LOCAL_ONLY=1

log() { echo "$(date -u +%FT%TZ) backup: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Database name and user come from the same .env the stack uses, unless set in the environment.
if [ -z "${PG_DB:-}" ] || [ -z "${PG_USER:-}" ]; then
  [ -f "$ROOT/.env" ] || die "no $ROOT/.env and PG_DB/PG_USER not set"
  # shellcheck disable=SC1090
  PG_USER="${PG_USER:-$(grep -E '^POSTGRES_USER=' "$ROOT/.env" | cut -d= -f2-)}"
  PG_DB="${PG_DB:-$(grep -E '^POSTGRES_DB=' "$ROOT/.env" | cut -d= -f2-)}"
fi
[ -n "$PG_USER" ] && [ -n "$PG_DB" ] || die "could not work out POSTGRES_USER / POSTGRES_DB"
[ -s "$PASS_FILE" ] || die "missing or empty passphrase file $PASS_FILE"
# Refuse a passphrase file other users can read.
perm="$(stat -c '%a' "$PASS_FILE" 2>/dev/null || stat -f '%Lp' "$PASS_FILE")"
case "$perm" in 600|400) ;; *) die "$PASS_FILE must be chmod 600 (it is $perm)" ;; esac

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/uposhom-$STAMP.dump.enc"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

log "dumping $PG_DB from $PG_CONTAINER"
# Custom format is compressed and lets pg_restore restore selectively. The dump is encrypted as it
# streams, so an unencrypted copy never touches the disk.
docker exec -i "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --no-owner \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" > "$TMP"

# An empty or tiny file means the dump failed even though the pipe exited cleanly.
size="$(wc -c < "$TMP" | tr -d ' ')"
[ "$size" -gt 1024 ] || die "dump is only $size bytes: refusing to keep it"
mv "$TMP" "$OUT"
chmod 600 "$OUT"
log "wrote $OUT ($size bytes)"

if [ "$LOCAL_ONLY" = "1" ]; then
  log "local-only: skipping upload"
  echo "$OUT"
  exit 0
fi

[ -f "$ENV_FILE" ] || die "missing $ENV_FILE (R2 credentials)"
# shellcheck disable=SC1090
. "$ENV_FILE"
for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [ -n "${!v:-}" ] || die "$v is not set in $ENV_FILE"
done
command -v rclone >/dev/null || die "rclone is not installed (sudo apt install rclone)"

# An rclone remote defined entirely from the environment: no config file holding the secret.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

log "uploading to r2:$R2_BUCKET/backups/"
rclone copyto "$OUT" "r2:$R2_BUCKET/backups/$(basename "$OUT")"
# Confirm it is really there with the same size before deleting anything.
remote="$(rclone size --json "r2:$R2_BUCKET/backups/$(basename "$OUT")" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
[ "$remote" = "$size" ] || die "uploaded size ($remote) does not match local size ($size)"
log "upload verified"

# Local copies: keep a few days on the VM disk. Remote: keep KEEP_DAYS.
find "$BACKUP_DIR" -name 'uposhom-*.dump.enc' -mtime +3 -delete
rclone delete "r2:$R2_BUCKET/backups" --min-age "${KEEP_DAYS}d" --include 'uposhom-*.dump.enc'
log "done"
