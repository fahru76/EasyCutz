/**
 * EasyCutz eval harness — the ONLY grader of the ETA estimator and slot engine.
 *
 *   npm run eval            score + compare with evals/baseline.json (fails on regression)
 *   npm run eval:baseline   accept the current numbers as the new baseline (only if all invariants pass)
 *
 * Metrics ("good" as numbers, see evals/README.md):
 *   accuracy   predicted start vs simulated real start, in minutes (MAE, p95 |error|, % within ±10)
 *   invariants pass rate of hard rules (must be 100%)
 *   latency    p95 ms per estimator snapshot / per slot query
 *   cost       RM 0 per finished task (no paid calls)
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildQueueSnapshot } from "@/lib/queue";
import { generateSlots } from "@/lib/slots";
import { EDGE_CASES, GENERATED_COUNT, GENERATED_SEED, generatedScenarios } from "./lib/scenarios";
import { MIN, NOW, simulate, toQueueInput, type Scenario } from "./lib/shop";
import { DATE, SLOT_EDGE_CASES, SLOT_GENERATED_SEED, TZ, generatedSlotCases, nowOf, oracle, type SlotCase } from "./lib/slot-cases";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const BASELINE = path.join(DIR, "baseline.json");
const RESULTS = path.join(DIR, "results", "latest.json");

/** Regression tolerances vs baseline (accuracy) and absolute budgets (latency). */
const TOLERANCE = { maeMin: 0.5, p95Min: 1, within10Pts: 2 };
const BUDGET_MS = { estimatorP95: 5, slotsP95: 10 };

interface Check {
  caseId: string;
  rule: string;
  pass: boolean;
  detail?: string;
}
interface Prediction {
  caseId: string;
  id: string;
  kind: "walk_in" | "booking";
  source: Scenario["source"];
  predictedMin: number;
  actualMin: number;
  errorMin: number;
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const minutesFromNow = (d: Date) => (d.getTime() - NOW.getTime()) / MIN;
function timeIt(fn: () => void, runs = 5): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return percentile(samples, 50);
}

// ---------------------------------------------------------------------------
// Estimator
// ---------------------------------------------------------------------------
function evalEstimator(s: Scenario, checks: Check[], predictions: Prediction[], latency: number[]) {
  const input = toQueueInput(s);
  const snap = buildQueueSnapshot(input);
  latency.push(timeIt(() => buildQueueSnapshot(input)));
  const actual = simulate(s);
  const onDuty = new Set(s.barbers.filter((b) => b.onDuty).map((b) => b.id));
  const check = (rule: string, pass: boolean, detail?: string) => checks.push({ caseId: s.id, rule, pass, detail });
  const overlapsBreak = (barberId: string, start: number, dur: number) =>
    s.breaks.some((b) => b.barberId === barberId && start < b.toMin && b.fromMin < start + dur);

  const intervals = new Map<string, Array<{ id: string; start: number; end: number }>>();
  const addInterval = (barberId: string, id: string, start: number, dur: number) =>
    intervals.set(barberId, [...(intervals.get(barberId) ?? []), { id, start, end: start + dur }]);

  for (const t of s.tickets) {
    const eta = snap.etas.get(t.id);
    const predicted = eta?.startsAt ? minutesFromNow(eta.startsAt) : null;
    check("walk-in gets an ETA when a chair is on duty", onDuty.size === 0 || predicted !== null, t.id);
    if (predicted === null || !eta?.barberId) continue;
    check("ETA never in the past", predicted >= -0.01, `${t.id} @ ${round(predicted)}`);
    check("never assigned to an off-duty barber", onDuty.has(eta.barberId), `${t.id} -> ${eta.barberId}`);
    if (t.preferredBarberId && onDuty.has(t.preferredBarberId)) {
      check("preferred barber honoured", eta.barberId === t.preferredBarberId, `${t.id} wants ${t.preferredBarberId}, got ${eta.barberId}`);
    }
    check("walk-in never projected into a break (EZ-003)", !overlapsBreak(eta.barberId, predicted, t.plannedMin), `${t.id} @ ${round(predicted)}`);
    addInterval(eta.barberId, t.id, predicted, t.plannedMin);
    const real = actual.starts.get(t.id);
    if (real !== undefined) {
      predictions.push({ caseId: s.id, id: t.id, kind: "walk_in", source: s.source, predictedMin: predicted, actualMin: real, errorMin: predicted - real });
    }
  }

  for (const a of s.appointments) {
    const eta = snap.appointmentEtas.get(a.id);
    if (a.checkedIn) check("checked-in booking is never dropped (EZ-011 regression)", eta !== undefined, a.id);
    if (!eta) continue;
    const predicted = minutesFromNow(eta.projectedStart);
    check("booking never projected before its booked time", predicted >= Math.min(a.startInMin, 0) - 0.01, `${a.id} @ ${round(predicted)}`);
    check(
      "booking never projected to START in a break (EZ-003)",
      !s.breaks.some((b) => b.barberId === a.barberId && b.fromMin <= predicted && predicted < b.toMin),
      `${a.id} @ ${round(predicted)}`,
    );
    addInterval(a.barberId, a.id, predicted, a.plannedMin);
    const real = actual.starts.get(a.id);
    if (real !== undefined) {
      predictions.push({ caseId: s.id, id: a.id, kind: "booking", source: s.source, predictedMin: predicted, actualMin: real, errorMin: predicted - real });
    }
  }

  // With no surprises (true = planned), the estimate must match the desk replay.
  const exact = s.inChair.every((c) => c.trueMin === c.plannedMin) && s.tickets.every((t) => t.trueMin === t.plannedMin) &&
    s.appointments.every((a) => a.trueMin === a.plannedMin);
  if (exact) {
    for (const p of predictions.filter((x) => x.caseId === s.id)) {
      // The desk may call a booking up to 10 min early, which moves everyone behind it.
      const tolerance = 10;
      check("matches the desk exactly when cuts run to plan", Math.abs(p.errorMin) <= tolerance, `${p.id}: predicted ${round(p.predictedMin)}, desk ${p.actualMin}`);
    }
  }

  for (const [barberId, list] of intervals) {
    const sorted = [...list].sort((x, y) => x.start - y.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      check("one customer per chair at a time", cur.start >= prev.end - 0.01, `${barberId}: ${prev.id} overlaps ${cur.id}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Slot engine
// ---------------------------------------------------------------------------
function evalSlots(c: SlotCase, checks: Check[], latency: number[]) {
  const query = {
    date: DATE, durationMin: c.durationMin, barberIds: c.barberIds, shifts: c.shifts, busy: c.busy, now: nowOf(c),
    timezone: TZ, slotIntervalMin: c.slotIntervalMin, minLeadMin: c.minLeadMin, breaks: c.breaks, bufferMin: c.bufferMin,
  };
  const slots = generateSlots(query);
  latency.push(timeIt(() => generateSlots(query)));
  const expected = oracle(c);
  const offered = new Map(slots.map((s) => [s.localMinute, [...s.availableBarberIds].sort()]));
  const unsafe: string[] = [];
  const missed: string[] = [];
  for (const [m, ids] of offered) {
    for (const id of ids) if (!(expected.get(m) ?? []).includes(id)) unsafe.push(`${id}@${m}`);
  }
  for (const [m, ids] of expected) {
    for (const id of ids) if (!(offered.get(m) ?? []).includes(id)) missed.push(`${id}@${m}`);
  }
  checks.push({ caseId: c.id, rule: "slot engine never offers an invalid time", pass: unsafe.length === 0, detail: unsafe.slice(0, 5).join(" ") });
  checks.push({ caseId: c.id, rule: "slot engine never hides a valid time", pass: missed.length === 0, detail: missed.slice(0, 5).join(" ") });
}

// ---------------------------------------------------------------------------
// Run + gate
// ---------------------------------------------------------------------------
describe("EasyCutz evals", () => {
  it("scores the estimator and slot engine and holds the line against the baseline", () => {
    const scenarios = [...EDGE_CASES, ...generatedScenarios()];
    const slotCases = [...SLOT_EDGE_CASES, ...generatedSlotCases()];
    const checks: Check[] = [];
    const predictions: Prediction[] = [];
    const estLatency: number[] = [];
    const slotLatency: number[] = [];

    for (const s of scenarios) evalEstimator(s, checks, predictions, estLatency);
    for (const c of slotCases) evalSlots(c, checks, slotLatency);

    const abs = predictions.map((p) => Math.abs(p.errorMin));
    const failed = checks.filter((c) => !c.pass);
    const metrics = {
      cases: { estimator: scenarios.length, slots: slotCases.length, total: scenarios.length + slotCases.length },
      predictions: predictions.length,
      accuracy: {
        maeMin: round(mean(abs)),
        p95AbsErrorMin: round(percentile(abs, 95)),
        within10Pct: round((100 * abs.filter((e) => e <= 10).length) / Math.max(1, abs.length), 1),
        biasMin: round(mean(predictions.map((p) => p.errorMin))),
        walkInMaeMin: round(mean(predictions.filter((p) => p.kind === "walk_in").map((p) => Math.abs(p.errorMin)))),
        bookingMaeMin: round(mean(predictions.filter((p) => p.kind === "booking").map((p) => Math.abs(p.errorMin)))),
      },
      invariants: {
        checks: checks.length,
        failed: failed.length,
        passRatePct: round((100 * (checks.length - failed.length)) / Math.max(1, checks.length), 2),
      },
      latency: { estimatorP95Ms: round(percentile(estLatency, 95), 3), slotsP95Ms: round(percentile(slotLatency, 95), 3) },
      cost: { perFinishedTaskMyr: 0, note: "no model or paid API calls" },
    };

    const report = {
      generatedAt: new Date().toISOString(),
      seeds: { scenarios: GENERATED_SEED, scenarioCount: GENERATED_COUNT, slots: SLOT_GENERATED_SEED },
      metrics,
      failedChecks: failed.slice(0, 50),
      worstPredictions: [...predictions]
        .sort((a, b) => Math.abs(b.errorMin) - Math.abs(a.errorMin))
        .slice(0, 10)
        .map((p) => ({ ...p, predictedMin: round(p.predictedMin), errorMin: round(p.errorMin) })),
    };
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2) + "\n");

    console.log(
      `\n[evals] ${metrics.cases.total} cases (${metrics.cases.estimator} queue, ${metrics.cases.slots} slots), ${metrics.predictions} predictions\n` +
        `  accuracy   MAE ${metrics.accuracy.maeMin} min · p95 ${metrics.accuracy.p95AbsErrorMin} min · within ±10 min ${metrics.accuracy.within10Pct}% · bias ${metrics.accuracy.biasMin} min\n` +
        `  invariants ${metrics.invariants.checks - metrics.invariants.failed}/${metrics.invariants.checks} pass (${metrics.invariants.passRatePct}%)\n` +
        `  latency    estimator p95 ${metrics.latency.estimatorP95Ms} ms · slots p95 ${metrics.latency.slotsP95Ms} ms · cost RM 0\n`,
    );
    for (const f of failed.slice(0, 10)) console.log(`  FAIL ${f.caseId}: ${f.rule} ${f.detail ?? ""}`);

    // Hard gates
    expect(failed, "invariant failures (see evals/results/latest.json)").toEqual([]);
    expect(metrics.cases.total).toBeGreaterThanOrEqual(50);
    expect(metrics.latency.estimatorP95Ms).toBeLessThan(BUDGET_MS.estimatorP95);
    expect(metrics.latency.slotsP95Ms).toBeLessThan(BUDGET_MS.slotsP95);

    if (process.env.EVAL_UPDATE_BASELINE === "1") {
      fs.writeFileSync(BASELINE, JSON.stringify({ acceptedAt: report.generatedAt, seeds: report.seeds, metrics }, null, 2) + "\n");
      console.log("[evals] baseline updated");
      return;
    }

    expect(fs.existsSync(BASELINE), "no baseline yet: run `npm run eval:baseline` once and commit evals/baseline.json").toBe(true);
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as { metrics: typeof metrics };
    const b = baseline.metrics.accuracy;
    const a = metrics.accuracy;
    expect(a.maeMin, `MAE regressed (${b.maeMin} -> ${a.maeMin})`).toBeLessThanOrEqual(b.maeMin + TOLERANCE.maeMin);
    expect(a.p95AbsErrorMin, `p95 error regressed (${b.p95AbsErrorMin} -> ${a.p95AbsErrorMin})`).toBeLessThanOrEqual(b.p95AbsErrorMin + TOLERANCE.p95Min);
    expect(a.within10Pct, `±10 min share regressed (${b.within10Pct} -> ${a.within10Pct})`).toBeGreaterThanOrEqual(b.within10Pct - TOLERANCE.within10Pts);
    expect(metrics.cases.total, "eval set shrank").toBeGreaterThanOrEqual(baseline.metrics.cases.total);
  });
});
