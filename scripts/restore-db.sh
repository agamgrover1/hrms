#!/usr/bin/env bash
# Restore a pg_dump backup produced by scripts/backup-db.sh.
#
# WARNING: this REPLACES the current database. It drops and recreates the
# `public` schema before importing, so every row in every DL HRMS table
# will be gone the moment the script proceeds. Use PITR (Neon console)
# for smaller "roll back a bad change" cases; use this only when you're
# rebuilding from scratch or restoring into a fresh DB.
#
# Usage: scripts/restore-db.sh backups/2026-07-30_120000.sql.gz
# Set  RESTORE_URL=<other-db-url>  to restore into a different target
# (useful for testing the backup against a fresh Neon branch first).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: scripts/restore-db.sh <backup-file.sql.gz>"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "❌ .env not found." >&2
  exit 1
fi
# Same manual parse as backup-db.sh — `source` mangles URLs containing &.
while IFS='=' read -r KEY VAL; do
  [[ -z "$KEY" || "$KEY" =~ ^[[:space:]]*# ]] && continue
  VAL="${VAL%\"}"; VAL="${VAL#\"}"
  VAL="${VAL%\'}"; VAL="${VAL#\'}"
  export "$KEY=$VAL"
done < .env

TARGET="${RESTORE_URL:-${DATABASE_URL:-}}"
if [[ -z "$TARGET" ]]; then
  echo "❌ No target: set RESTORE_URL or DATABASE_URL in .env." >&2
  exit 1
fi

PSQL="/opt/homebrew/opt/libpq/bin/psql"
if [[ ! -x "$PSQL" ]]; then
  PSQL="$(command -v psql || true)"
fi
if [[ -z "$PSQL" ]]; then
  echo "❌ psql not found. Install with: brew install libpq" >&2
  exit 1
fi

# Mask password before echoing.
MASKED="$(echo "$TARGET" | sed -E 's#(://[^:]+:)[^@]+#\1***#')"
echo "About to restore $FILE into:"
echo "  $MASKED"
echo
read -rp "Type 'YES REPLACE' to continue: " CONFIRM
if [[ "$CONFIRM" != "YES REPLACE" ]]; then
  echo "Aborted."
  exit 1
fi

echo "→ Dropping and recreating public schema…"
"$PSQL" "$TARGET" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
SQL

echo "→ Importing (this can take several minutes)…"
gunzip -c "$FILE" | "$PSQL" "$TARGET" -v ON_ERROR_STOP=1

echo "✅ Restore complete."
