#!/usr/bin/env bash
# Runs the SQL smoke suite (run-local.sh) once per shop weekday and time of day
# (default 10:00 and 23:50 shop-local), with the clock pinned via libfaketime.
# Deterministic, and catches weekday-dependent bugs that a real-clock run only hits on one day a week
# (e.g. the Monday "next Tuesday = tomorrow" booking collision) or only near
# midnight (e.g. "now + 25 min" landing on tomorrow's shop day).
#   Usage:  bash supabase/tests/run-weekdays.sh
#   Needs:  everything run-local.sh needs, plus libfaketime
#           (Debian/Ubuntu: apt-get install faketime), or FAKETIME_LIB pointing at it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHOP_TZ="Asia/Kuala_Lumpur"   # seed shop_settings.timezone
read -r -a TIMES <<<"${SMOKE_TIMES:-10:00 23:50}"   # shop-local times of day to pin

FAKETIME_LIB="${FAKETIME_LIB:-$(ls /usr/lib/*/faketime/libfaketimeMT.so.1 /usr/lib/faketime/libfaketimeMT.so.1 2>/dev/null | head -1 || true)}"
if [[ -z "$FAKETIME_LIB" || ! -f "$FAKETIME_LIB" ]]; then
  echo "libfaketime not found: install it (apt-get install faketime) or set FAKETIME_LIB" >&2
  exit 2
fi

# libfaketime (0.9.10) leaves a /dev/shm segment + semaphore behind for most faked
# processes; enough of them make sem_open fail. Remove only the ones this script made.
faketime_shm() { find /dev/shm -maxdepth 1 -user "$(id -u)" \( -name 'faketime_shm_*' -o -name 'sem.faketime_sem_*' \) 2>/dev/null | sort; }
SHM_BEFORE="$(faketime_shm)"
cleanup_shm() { comm -13 <(printf '%s\n' "$SHM_BEFORE") <(faketime_shm) | xargs -r rm -f --; }
trap cleanup_shm EXIT

failed=0
# A fixed Monday..Sunday week keeps runs reproducible; every date in the suite is relative to now().
for day in 2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 2026-10-11; do
for AT in "${TIMES[@]}"; do
  utc="$(TZ=UTC date -d "TZ=\"$SHOP_TZ\" $day $AT" '+%Y-%m-%d %H:%M:%S')"
  label="$(TZ="$SHOP_TZ" date -d "$day" '+%a %Y-%m-%d') $AT"
  if log="$(LD_PRELOAD="$FAKETIME_LIB" FAKETIME="@$utc" FAKETIME_DONT_FAKE_MONOTONIC=1 \
            bash "$ROOT/supabase/tests/run-local.sh" 2>&1)"; then
    echo "pass  $label"
  else
    echo "FAIL  $label"
    grep -E "^--- |ERROR|DETAIL|FATAL|libfaketime" <<<"$log" | tail -6 | sed 's/^/      /'
    failed=1
  fi
  cleanup_shm
done
done
exit "$failed"
