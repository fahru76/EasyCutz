@AGENTS.md

# Engineering rules (EasyCutz)

Adapted from the "Staff AI Engineer" operating guide (adopted 2026-10-04). The job is to ship
behaviour that holds up in a real barbershop, not demos. Nothing ships until it is measured and
verified.

**Applies now** = enforced today. **When AI is added** = no model or LLM calls exist yet;
these rules bind the first feature that adds one.

## 1. Start from the eval — applies now
- The predictive code is the **ETA estimator** (`src/lib/queue.ts`) and the **slot engine**
  (`src/lib/slots.ts`). Any change to them starts in `evals/`: add the case that shows the
  problem, watch it fail, then change the code. See `evals/README.md`.
- "Good" is a number: invariant pass rate 100%, ETA MAE / p95 / % within ±10 min, latency p95,
  cost per finished task (RM 0 today).
- `npm run check` includes `npm run eval`. No vibes and no single-example wins. Re-baseline only
  with `npm run eval:baseline`, after reading why the numbers moved, and commit `baseline.json`
  with the code.
- The author never grades their own change; the harness does. Never edit the grader to make a
  change pass. If the yardstick is wrong, fix it in its own step and re-measure the old code.
- Every bug becomes a regression case (edge case in `evals/` or a SQL smoke test).

## 2. Context is the product — when AI is added
- Send evidence, not summaries: the row, the log line, the diff.
- Stable blocks first so prompt caching hits; rebuild state each turn; cap and paginate tool
  output; retrieval casts wide, a reranker decides what the model sees.

## 3. Right model for each job — when AI is added
- Route by task (cheap for routine, frontier for hard calls); set effort per step; typed
  decisions (which tool, retry or stop) go to code, not prose; escalate on evidence.

## 4. Tools are contracts — applies now
- Every RPC/API has a schema (zod at the edge, SQL checks in the database), a clear purpose,
  stable error codes (`src/lib/server/errors.ts`) and safe retries. Desk and admin RPCs
  re-check permissions (`assert_staff` / `assert_owner`).
- Irreversible actions sit behind an explicit confirmation: cancel, close shop, reopen and
  refund-flag are two-step in the UI and audited in the database.
- Secrets never enter the transcript, logs, artifacts or the repo. `.env.local` is git-ignored;
  only `.env.example` is committed.

## 5. Verify in code — applies now
- Deterministic checks before judgment: `npm run check` (types, lint, unit tests, evals),
  `npm run test:db` (SQL smoke), then browser E2E for UI flows.
- Read a failure before re-running. A green rerun after a blind edit is not evidence.
- Prove a new gate can fail: break it on purpose once, see it go red, then restore.
- Never hide or soften a failed verification in a report.

## 6. Ship like production — partly now
- Migrations are append-only and replayable; the combined setup SQL is re-verified against a
  copy of the old schema before delivery.
- Prove a change on a branch with every gate green before it merges to `main`.
- *Follow-up:* trace API routes (route, status, latency, error code; no PII).
- *When AI is added:* pin model versions (no silent behaviour change), trace inputs, tool calls,
  tokens, latency, cost and outcome, canary prompt changes, and track cost per finished task
  rather than per call.

## Task management
1. **Plan first:** write the plan in `tasks/todo.md` with checkable items.
2. **Eval first:** add the failing case to `evals/` (or a SQL smoke test) before changing logic.
3. **Track progress:** tick items as they land.
4. **Explain changes:** give a short, high-level summary at each step.
5. **Document results:** add a Review section to the task in `tasks/todo.md`.
6. **Capture lessons:** after every correction or surprise, add it to `tasks/lessons.md`.

## Core principles
- **Evals over opinions:** if it isn't measured, it isn't better.
- **Simplicity first:** the smallest change that passes the evals wins.
- **Own the failure mode:** know how it breaks before you know how it works.
- **Cost is a feature:** same quality at a tenth of the price is a promotion.
- **Ship weekly:** production feedback beats a perfect roadmap.
