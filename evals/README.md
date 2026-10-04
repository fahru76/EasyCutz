# EasyCutz evals

The ETA estimator (`src/lib/queue.ts`) and the slot engine (`src/lib/slots.ts`) are the
product's predictive models: customers act on the wait times and bookable times they show.
This folder holds the **eval set and the only grader** for them. Change either file, and the
evals decide whether it got better. Nobody's opinion, including the author's, does.

```bash
npm run eval            # score and compare with evals/baseline.json; fails on any regression
npm run eval:baseline   # accept the current numbers (only after reading them; commit the file)
npm run check           # typecheck + lint + unit tests + evals
```

## What "good" means (numbers)

| Metric | What it measures | Gate |
| --- | --- | --- |
| **Invariant pass rate** | Hard rules (below) over every case | **100%** |
| **MAE** (min) | Mean \|predicted start − real start\| over walk-ins and bookings | ≤ baseline + 0.5 |
| **p95 \|error\|** (min) | Tail of the same errors | ≤ baseline + 1 |
| **Within ±10 min** (%) | Share of predictions a customer would call "right" | ≥ baseline − 2 pts |
| **Bias** (min) | Mean signed error (+ = we over-estimate waits) | reported |
| **Latency p95** (ms) | Per estimator snapshot / per slot query | < 5 ms / < 10 ms |
| **Cost per finished task** | Paid calls per booking/ticket | RM 0 (no model calls) |
| **Eval set size** | Cases | ≥ 50 and never shrinks |

Current numbers live in `baseline.json`; every run writes `results/latest.json`, which holds
the metrics, failed checks and the 10 worst predictions (not committed).

## Where "real start" comes from

`lib/shop.ts` → `simulate()` is a **ground-truth shop**. It is written independently of the
estimator and replays the desk's SQL rules (`desk_call_next`):

- A chair frees when the cut's **true** length ends. True length = planned length × the barber's
  speed bias × per-cut noise. This is what EZ-005 will learn.
- Nobody is called while the barber is on a break.
- A booking is called up to 10 min early, but never pulled forward into a break.
- Otherwise the oldest walk-in whose planned cut + rest buffer fits before the next booking or
  break is called.

The estimator only sees planned lengths, which is exactly the information it has in production.
If the simulator and the SQL ever disagree, the simulator is wrong: fix it first, then re-read
the numbers.

## Hard rules (invariants)

Estimator, on every scenario:

- every walk-in gets an ETA when any chair is on duty;
- no ETA is in the past;
- walk-ins never go to an off-duty barber, and the preferred barber is honoured;
- a walk-in never overlaps a break;
- a booking never *starts* inside a break and is never projected before its booked time;
- a checked-in booking is never dropped (EZ-011 regression);
- one customer per chair at a time;
- when cuts run exactly to plan, the estimate matches the desk replay within 10 min (the desk's
  early-call window).

Slot engine, on every case: the offered set equals a brute-force oracle (`lib/slot-cases.ts`).
It must never offer an invalid time and never hide a valid one.

## The eval set

- **Edge cases** (`lib/scenarios.ts`, `lib/slot-cases.ts`): hand-written, including a regression
  case for every bug found. `FOUND BY EVAL` marks issues this harness surfaced itself.
- **Generated**: 60 queue scenarios and 60 slot cases from fixed seeds (`GENERATED_SEED`,
  `SLOT_GENERATED_SEED`). Same seed, same set, so runs are comparable.
- There is no production data yet. Once the app is live, replace or extend the generated set
  with anonymised real days (per-ticket planned vs actual seat and finish times, with no names or
  phones) and re-baseline.

## Workflow (from `CLAUDE.md`)

1. Write the failing case first: add a scenario that shows the problem and watch it fail.
2. Change the code.
3. Run `npm run eval` and read the numbers and `results/latest.json`. A green run after a blind
   edit is not evidence.
4. Only if every metric holds or improves for a reason you can explain, run
   `npm run eval:baseline` and commit `baseline.json` with the code.
5. Never edit the grader to make a change pass. If the yardstick is wrong, fix it in its own
   commit with the reason, and re-baseline the *old* code first.

## History

Same 143 cases and the same desk replay in both rows; only the estimator differs.

| Date | Estimator | MAE | p95 | ±10 min | Bias | Invariant failures |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-04 | As shipped in EZ-003 | 23.6 | 110 | 63.2% | +15.47 | 4 |
| 2026-10-04 | Gap-fill like the desk; bookings only pushed when they *start* in a break; desk SQL aligned (migration 009) | **13.61** | **49** | **73.1%** | **+4.58** | **0** |

The remaining tail (misses of 150–220 min) comes from cuts finishing earlier or later than
planned. That flips whether a walk-in fits a gap before a booking, and the estimator can't know
it from planned lengths alone. That is the target for EZ-005 (learned cut durations).
