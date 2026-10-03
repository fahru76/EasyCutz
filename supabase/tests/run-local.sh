#!/usr/bin/env bash
# Runs the EasyCutz migrations + seed + smoke tests against a throwaway local
# PostgreSQL cluster (no Docker / Supabase CLI needed).
#   Usage:  bash supabase/tests/run-local.sh
#   Needs:  PostgreSQL 15+ server binaries (initdb, pg_ctl) and psql on PATH,
#           or PG_BIN pointing at them (e.g. /usr/lib/postgresql/16/bin).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f "$ROOT/supabase/tests/local_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"   # idempotency check
"${PSQL[@]}" -f "$ROOT/supabase/tests/smoke.sql"
