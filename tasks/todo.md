# EasyCutz — task plan

Working rules live in `CLAUDE.md` → "Engineering rules". Plan here first, tick items as they land,
and add a **Review** section when a task is done.

---

## Task: Apply the "Staff AI Engineer" operating guide (2026-10-04)

**Goal.** Make every change to EasyCutz's predictive logic *measured*, not eyeballed.
EasyCutz makes no LLM/model calls today. Its "models" are the **walk-in ETA estimator**
(`src/lib/queue.ts`) and the **slot engine** (`src/lib/slots.ts`). Customers see their output
as wait times and bookable times. So the guide is applied to those two now, and its AI-specific
rules are recorded for the first AI feature.

### Plan
- [x] Rules: add "Engineering rules" to `CLAUDE.md`, adapted to this repo. Mark which rules apply
      now and which apply only once an AI feature exists.
- [x] Workflow files: `tasks/todo.md` (this file) and `tasks/lessons.md`, seeded with the real
      corrections from EZ-001…EZ-003.
- [x] Define "good" as numbers (`evals/README.md`):
  - [x] estimator **accuracy** against a ground-truth simulation: MAE, p95 absolute error,
        % of walk-ins within ±10 min;
  - [x] **invariant pass rate** (must be 100%) for the estimator and the slot engine;
  - [x] **latency** p95 per snapshot (ms);
  - [x] cost = RM 0 (no paid calls). Re-define it if a model is ever added.
- [x] Eval set of ≥ 50 cases:
  - [x] hand-written edge cases, including regressions for every bug we hit;
  - [x] seeded generated scenarios (deterministic, reproducible).
- [x] Ground truth independent of the estimator: a discrete-event "real shop" simulator with
      true service durations that differ from the planned ones.
- [x] Harness: `npm run eval` writes `evals/results/latest.json`, compares against
      `evals/baseline.json`, and fails on any invariant failure or a metric regression beyond
      tolerance. Add it to `npm run check`.
- [x] Verify: run it, read the numbers, prove the gate catches a deliberate regression, then
      revert that regression.
- [x] Deliver: commit, merge to `main`, update the project status doc. (The `C:\EasyCutz` sync
      step done at the time is retired: git runs only on GitHub or in the cloud.)

### Out of scope (follow-ups)
- Production tracing of API routes (route, status, latency, error code; no PII).
- EZ-005 learned durations. This harness is what will prove it helps (target: lower MAE).
- ~~Make the EZ-011 smoke section time-independent~~: done 2026-10-05 (see the task below).

### Review
- **Eval set:** 143 cases (75 queue scenarios, 68 slot cases), 546 graded predictions, 2,395 hard
  checks per run. Runs in about 1 s.
- **The harness found 4 real defects on its first run.** The estimator did not gap-fill like the
  desk, and pushed bookings that merely overlapped a break. The desk ignored the rest buffer and
  could call a booking early into a break. All four are now edge cases.
- **Fixed:** estimator (`src/lib/queue.ts`) and desk SQL (migration 009). Same eval set and same
  desk replay, before → after: MAE 23.6 → 13.61 min, p95 110 → 49 min, within ±10 min 63.2% →
  73.1%, bias +15.47 → +4.58 min, invariant failures 4 → 0. Latency p95: 0.14 ms (estimator),
  1.6 ms (slots).
- **Gates proven:** reverting the gap-fill fix fails on invariants. A silent change (overrun
  guess 25% → 60%) passes every invariant but fails "MAE regressed (13.61 → 15.88)". The new SQL
  smoke tests fail without migration 009 and pass with it.
- **Yardstick fixes made first:** the simulator freed chairs in the past and didn't mirror the
  desk's early-call rule. Both were fixed before baselining.
- **Remaining error** is from cuts running longer or shorter than planned: the EZ-005 target.

---

## Task: Run the SQL smoke suite in CI (2026-10-05)

**Goal.** `npm run test:db` gates every PR and every push to `main`, like `npm run check`.

### Plan
- [x] Run `npm run test:db` locally first. It **failed on today's date (a Monday)**: EZ-001's
      "tomorrow 15:00" booking collided with an earlier section's "next Tuesday" bookings.
- [x] Reproduce with a pinned clock (libfaketime) on all 7 weekdays × 5 times of day: only
      Mondays fail, plus the known 23:35-midnight EZ-011 window on every day.
- [x] Fix the yardstick (test-only): `next_tuesday_at()` now lands 4-10 days ahead (never
      inside EZ-001's tomorrow..+3 window); EZ-001's far booking moved from +10 to +11 days.
- [x] `supabase/tests/run-weekdays.sh` + `npm run test:db:week`: the suite once per weekday at
      10:00 shop-local, so CI is deterministic and catches weekday-only bugs.
- [x] CI: new `db` job (PostgreSQL server + libfaketime from apt, then `npm run test:db:week`).
- [x] Prove the gate can fail: the old `smoke.sql` fails Monday in the sweep; the fix passes all 7.

### Review
- **Bug found by the gate itself:** the SQL smoke suite failed every Monday. Fixed in the test
  only; no migration or app code changed.
- **Verified locally:** `test:db:week` passes 7/7 with the fix and fails Monday (exit 1) without
  it; real-clock `npm run test:db` passes on Monday 20:28 shop-local.
- **Not fixed:** the EZ-011 near-midnight window (scenario needs a same-day appointment 25 min
  ahead). CI is immune because the clock is pinned; local real-clock runs are not.

---

## Task: Fix the smoke suite's time-of-day windows (2026-10-05)

**Goal.** `npm run test:db` passes at any time of day, not just in CI's pinned slot.

### Plan
- [x] Failing case first: `test:db:week` also runs at 23:50 shop-local. On the old SQL it fails
      on all 7 days at EZ-011 (`called the cut that fits`).
- [x] Fix: `pg_temp.pin_shop_to_morning()` / `pg_temp.restore_shop_tz()` around EZ-011. The
      shop timezone becomes an `Etc/GMT±N` zone where it is 10:xx local, then is restored.
      No skips; the section always runs.
- [x] Hourly grid (every hour at :50, plus 00:00, 00:01, 12:45, 13:45, 14:29, 23:35, 23:59) on
      all 7 days found a second window: EZ-003 take-break inside Chandra's lunch / Friday
      prayers. Same fix around that block. Pinned to 10:xx, the Danial check there also stops
      skipping itself near midnight.
- [x] `run-weekdays.sh` cleans up the `/dev/shm` entries libfaketime leaks.

### Review
- **Grid:** 217/217 runs pass (31 times × 7 days). Default sweep: 14/14, 0 leaked entries.
- **Gate proven:** old `smoke.sql` fails the default sweep at 23:50 on every day (exit 1).
- **Test-only:** no migration or app code changed. `npm run check` passes.
