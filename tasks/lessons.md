# Lessons

One line per lesson: what went wrong, why, and the rule that prevents it. Add to this file after
every correction or surprise (see `CLAUDE.md` → Task management).

## Product logic
- **The estimator and the desk must follow the same rules.** The ETA estimator assumed strict
  first-come order, but `desk_call_next` calls the oldest walk-in that *fits*. Customers were told
  waits of hours when the desk would call them at once. → Any change to call-next rules updates
  `src/lib/queue.ts`, the eval simulator (`evals/lib/shop.ts`) and a SQL smoke test together.
  *(found by the eval harness, 2026-10-04)*
- **Rest buffer was enforced for bookings but ignored by Call Next.** → Every timing setting must
  be honoured by the slot engine, the estimator and `desk_call_next` (migration 009).
- **"In a break" means the booking STARTS in the break.** A booking that starts before a break is
  served on time; it is never pulled forward *into* a break. → One rule, three places (see above).
- **A checked-in customer must never be dropped as a no-show** (EZ-011 late-grace bug). → Covered
  by an eval invariant.

## Time and clocks
- **`now()` is fixed for a whole transaction.** An end-break followed by a check inside the same
  `do $$` block saw the break still active. → In SQL tests, put "act" and "assert" in separate
  statements when time matters.
- **Tests that use `now() + N minutes` break near midnight** (the EZ-011 smoke section failed from
  about 23:35), **and inside seeded breaks** (EZ-003's take-break failed at 13:45-14:30, Chandra's
  lunch). → Don't skip by time window. Wrap the section in `pg_temp.pin_shop_to_morning()` /
  `pg_temp.restore_shop_tz()`, which switch the shop to a fixed-offset zone where it is 10:xx local.
- **Sweep the clock, not one sample.** Two runs a day found the midnight bug; an hourly grid on all
  7 days found the lunchtime one. → Before trusting a time fix, run
  `SMOKE_TIMES="00:50 01:50 ... 23:50" npm run test:db:week` once.
- **libfaketime 0.9.10 leaks `/dev/shm` segments** (one per faked process); after ~5,000 every
  run failed with `sem_open failed`. It has no `FAKETIME_DISABLE_SHM`. → `run-weekdays.sh`
  removes the entries it created; read a failure's own log before blaming the test.
- **Weekday-relative test dates collide on some days.** `next_tuesday_at()` returned 1-7 days
  ahead, so on a Monday "next Tuesday" was tomorrow and clashed with EZ-001's own "tomorrow"
  bookings: the smoke suite failed every Monday and passed the rest of the week. → Keep relative
  dates from different sections in disjoint ranges, and run SQL tests on every weekday with a
  pinned clock (`npm run test:db:week`, libfaketime) rather than trusting today's date.
- **A UI clock that ticks every 10 s judged fresh server data as "not started yet"** (desk break
  state lagged). → Compare server timestamps against `max(clock tick, last refresh time)`.

## Tooling and environment
- Stripe v23 renamed `payment_method_types` to `allowed_payment_method_types`. Check the installed
  SDK's types, not memory.
- Next 16: `proxy.ts` replaces middleware; params are async; fonts are self-hosted because Google
  Fonts is blocked in the sandbox. Read `node_modules/next/dist/docs/` first (`AGENTS.md`).
- React lint `set-state-in-effect`: derive state instead (or use `useSyncExternalStore`).
- `initdb` refuses to run as root, so local Postgres runs as user `claude`.
- `pkill -f <pattern>` and `/proc` scans can match **your own shell** when the pattern appears in
  the command line. → Kill by PID, found in a separate command.
- The local PostgREST shim has **no realtime**. → UI must refresh after its own actions; never
  rely on realtime alone (closure banner fix, EZ-001).
- **Local E2E sessions expire:** the shim-only test JWTs were minted with a 24 h expiry, so the
  next day the desk silently redirected to login. → When an E2E run stops at a staff page, check
  token expiry first; re-mint test tokens with a longer expiry (never real keys).
- E2E token files: names with spaces ("Ben T.") break naive `split(" ")`. → Split on the last
  space.

## Process
- **Measure the yardstick before trusting it.** The first eval run showed "started 9 min ago":
  the simulator was wrong, not the app. → Read the worst cases before setting a baseline.
- **Prove a gate can fail.** Break the code on purpose once (both an invariant break and a silent
  metric regression) and confirm the gate goes red before relying on it.
- **Stale lock files in the Windows folder:** a `git status` without delete permission left an
  empty `.git/index.lock`. → Request delete permission before any git command that writes there.
  *(Moot since 2026-10-05: the PC copy is retired.)*
- **One source of truth (2026-10-05):** the user retired the `C:\EasyCutz` PC copy. → Work only
  in the GitHub repo; never plan a "sync the PC folder" step.
