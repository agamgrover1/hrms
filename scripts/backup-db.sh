#!/usr/bin/env bash
# On-demand Postgres backup for the DL HRMS.
#
# Reads DATABASE_URL from .env (never hard-codes credentials) and writes
# a compressed pg_dump to backups/YYYY-MM-DD_HHMMSS.sql.gz. Both schema
# and data. Restore with scripts/restore-db.sh.
#
# Neon already provides point-in-time recovery for the last 7 days (or
# 30, depending on plan) via the console — this script is the belt-and-
# braces long-term archive so we have exports going back further than
# Neon's window keeps.
#
# Requires pg_dump. If missing on macOS:
#   brew install libpq
# then use the pinned path below (libpq is keg-only).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Load .env without printing secrets. `source .env` gets confused when a
# value contains &, ?, or other shell metachars (Neon URLs have both), so
# we read line-by-line and export via the shell builtin — the value stays
# literal, no expansion.
if [[ ! -f .env ]]; then
  echo "❌ .env not found. Copy .env.example to .env and set DATABASE_URL." >&2
  exit 1
fi
while IFS='=' read -r KEY VAL; do
  [[ -z "$KEY" || "$KEY" =~ ^[[:space:]]*# ]] && continue
  # Strip surrounding quotes if any.
  VAL="${VAL%\"}"; VAL="${VAL#\"}"
  VAL="${VAL%\'}"; VAL="${VAL#\'}"
  export "$KEY=$VAL"
done < .env
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL is not set in .env." >&2
  exit 1
fi

# Prefer the brew-installed libpq pg_dump; fall back to PATH.
PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
if [[ ! -x "$PG_DUMP" ]]; then
  PG_DUMP="$(command -v pg_dump || true)"
fi
if [[ -z "$PG_DUMP" ]]; then
  echo "❌ pg_dump not found. Install with: brew install libpq" >&2
  exit 1
fi

mkdir -p backups
STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
OUT="backups/${STAMP}.sql.gz"

echo "→ Dumping to $OUT (this can take a minute on cold Neon)…"
# --no-owner / --no-privileges keep the dump portable across Neon projects
# so a restore into a fresh empty DB doesn't fail on missing roles.
"$PG_DUMP" \
  --no-owner --no-privileges --no-comments \
  --format=plain \
  "$DATABASE_URL" | gzip -9 > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✅ Backup written: $OUT ($SIZE)"
echo
echo "Restore with:"
echo "  scripts/restore-db.sh $OUT"
