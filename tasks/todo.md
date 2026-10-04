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
- [ ] Deliver: commit, merge to `main`, sync `C:\EasyCutz`, update the project status doc.

### Out of scope (follow-ups)
- Production tracing of API routes (route, status, latency, error code; no PII).
- EZ-005 learned durations. This harness is what will prove it helps (target: lower MAE).
- Make the EZ-011 smoke section time-independent (it fails if run between ~23:35 and midnight).

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
