/**
 * The eval set: hand-written edge cases (every bug we hit becomes one) plus
 * seeded generated scenarios. Same seed => same set, so results are comparable
 * run to run. Bump GENERATED_SEED only together with a new baseline.
 */
import { rng, type Rng } from "./rng";
import type { Scenario, SimAppointment, SimBarber, SimBreak, SimInChair, SimTicket } from "./shop";

export const GENERATED_SEED = 20261004;
export const GENERATED_COUNT = 60;

const three: SimBarber[] = [
  { id: "aiman", sortOrder: 1, onDuty: true },
  { id: "bryan", sortOrder: 2, onDuty: true },
  { id: "chandra", sortOrder: 3, onDuty: true },
];
const one: SimBarber[] = [{ id: "aiman", sortOrder: 1, onDuty: true }];
const tk = (n: number, plannedMin: number, trueMin = plannedMin, preferredBarberId: string | null = null): SimTicket => ({
  id: `t${n}`, number: n, preferredBarberId, plannedMin, trueMin,
});
const base = { inChair: [] as SimInChair[], tickets: [] as SimTicket[], appointments: [] as SimAppointment[], breaks: [] as SimBreak[], bufferMin: 0 };

export const EDGE_CASES: Scenario[] = [
  { ...base, id: "edge-empty-shop", source: "edge", note: "empty shop, one walk-in starts now", barbers: one, tickets: [tk(1, 30)] },
  {
    ...base, id: "edge-overrun", source: "edge", note: "cut running 10 min over; estimator assumes max(5, 25%) left",
    barbers: one, inChair: [{ barberId: "aiman", kind: "ticket", id: "c1", elapsedMin: 40, plannedMin: 30, trueMin: 45 }],
    tickets: [tk(1, 30)],
  },
  {
    ...base, id: "edge-regression-late-grace", source: "edge",
    note: "REGRESSION (EZ-011): checked-in booking past its time while the chair is busy must not be dropped",
    barbers: one, inChair: [{ barberId: "aiman", kind: "ticket", id: "c1", elapsedMin: 50, plannedMin: 45, trueMin: 55 }],
    appointments: [{ id: "a1", barberId: "aiman", startInMin: -20, plannedMin: 30, trueMin: 30, checkedIn: true }],
    tickets: [tk(1, 20)],
  },
  {
    ...base, id: "edge-cascade", source: "edge", note: "15-min overrun cascades through three bookings on one chair",
    barbers: one, inChair: [{ barberId: "aiman", kind: "appointment", id: "c1", elapsedMin: 30, plannedMin: 30, trueMin: 45 }],
    appointments: [
      { id: "a1", barberId: "aiman", startInMin: 0, plannedMin: 30, trueMin: 30, checkedIn: true },
      { id: "a2", barberId: "aiman", startInMin: 30, plannedMin: 30, trueMin: 30, checkedIn: false },
      { id: "a3", barberId: "aiman", startInMin: 60, plannedMin: 30, trueMin: 30, checkedIn: false },
    ],
  },
  {
    ...base, id: "edge-break-now", source: "edge", note: "EZ-003: barber on a break for 20 more min",
    barbers: one, breaks: [{ barberId: "aiman", fromMin: -5, toMin: 20, label: "Lunch" }], tickets: [tk(1, 30)],
  },
  {
    ...base, id: "edge-break-soon-fit", source: "edge", note: "EZ-003: break in 15 min — 10-min cut fits before it, 45-min does not",
    barbers: one, breaks: [{ barberId: "aiman", fromMin: 15, toMin: 45, label: "Prayers" }], tickets: [tk(1, 45), tk(2, 10)],
  },
  {
    ...base, id: "edge-booking-in-break", source: "edge", note: "EZ-003: a booking that falls in a break is pushed past it",
    barbers: one, breaks: [{ barberId: "aiman", fromMin: 10, toMin: 40, label: "Break" }],
    appointments: [{ id: "a1", barberId: "aiman", startInMin: 15, plannedMin: 20, trueMin: 20, checkedIn: false }],
  },
  {
    ...base, id: "edge-preferred", source: "edge", note: "preferred barber is honoured even when another chair is free",
    barbers: three, inChair: [{ barberId: "bryan", kind: "ticket", id: "c1", elapsedMin: 10, plannedMin: 40, trueMin: 40 }],
    tickets: [tk(1, 30, 30, "bryan"), tk(2, 30)],
  },
  {
    ...base, id: "edge-preferred-off-duty", source: "edge", note: "preference for an off-duty barber falls back to any chair",
    barbers: [...three.slice(0, 2), { id: "chandra", sortOrder: 3, onDuty: false }], tickets: [tk(1, 30, 30, "chandra")],
  },
  {
    ...base, id: "edge-buffer", source: "edge", note: "EZ-003: 10-min rest buffer after each service",
    barbers: one, bufferMin: 10, inChair: [{ barberId: "aiman", kind: "ticket", id: "c1", elapsedMin: 15, plannedMin: 30, trueMin: 30 }],
    tickets: [tk(1, 30), tk(2, 20)],
  },
  {
    ...base, id: "edge-gap-aware", source: "edge", note: "EZ-011: 45-min walk-in can't fit the 25-min gap before a booking; 20-min one can",
    barbers: one, appointments: [{ id: "a1", barberId: "aiman", startInMin: 25, plannedMin: 45, trueMin: 45, checkedIn: false }],
    tickets: [tk(1, 45), tk(2, 20)],
  },
  {
    ...base, id: "edge-fifo-two-chairs", source: "edge", note: "six walk-ins over two chairs keep their order",
    barbers: three.slice(0, 2), tickets: [tk(1, 30), tk(2, 20), tk(3, 45), tk(4, 30), tk(5, 20), tk(6, 40)],
  },
  {
    ...base, id: "edge-gap-fill-later-short", source: "edge",
    note: "FOUND BY EVAL: desk calls the oldest walk-in that FITS before a booking, so a later 20-min cut goes first",
    barbers: one, appointments: [{ id: "a1", barberId: "aiman", startInMin: 34, plannedMin: 70, trueMin: 70, checkedIn: false }],
    tickets: [tk(1, 40), tk(2, 20)],
  },
  {
    ...base, id: "edge-booking-overlaps-break-start", source: "edge",
    note: "FOUND BY EVAL: a booking that starts before a break (and runs into it) is still called at its time",
    barbers: one, breaks: [{ barberId: "aiman", fromMin: 30, toMin: 60, label: "Break" }],
    appointments: [{ id: "a1", barberId: "aiman", startInMin: 20, plannedMin: 30, trueMin: 30, checkedIn: false }],
  },
  {
    ...base, id: "edge-only-chair-on-break", source: "edge", note: "only one barber on duty and on a break; walk-ins wait for the break end",
    barbers: [{ id: "aiman", sortOrder: 1, onDuty: true }, { id: "bryan", sortOrder: 2, onDuty: false }],
    breaks: [{ barberId: "aiman", fromMin: 0, toMin: 30, label: "Lunch" }], tickets: [tk(1, 20), tk(2, 20)],
  },
];

const MENU = [20, 30, 40, 45, 60, 70];

/** True cut time: barber speed bias × per-cut noise (what EZ-005 will learn). */
function trueOf(r: Rng, planned: number, speed: number) {
  return Math.max(5, Math.round(planned * speed * r.between(0.85, 1.2)));
}

export function generatedScenarios(seed = GENERATED_SEED, count = GENERATED_COUNT): Scenario[] {
  const r = rng(seed);
  const out: Scenario[] = [];
  for (let i = 0; i < count; i++) {
    const n = r.int(1, 4);
    const barbers: SimBarber[] = ["aiman", "bryan", "chandra", "danial"].slice(0, n).map((id, k) => ({
      id, sortOrder: k + 1, onDuty: k === 0 || r.chance(0.85),
    }));
    const speed = new Map(barbers.map((b) => [b.id, r.pick([0.85, 0.95, 1, 1.1, 1.25])]));
    const onDuty = barbers.filter((b) => b.onDuty);

    const inChair: SimInChair[] = [];
    const appointments: SimAppointment[] = [];
    const breaks: SimBreak[] = [];
    for (const b of onDuty) {
      if (r.chance(0.6)) {
        const planned = r.pick(MENU);
        inChair.push({
          barberId: b.id, kind: r.chance(0.7) ? "ticket" : "appointment", id: `c-${b.id}`,
          elapsedMin: r.int(0, planned + 10), plannedMin: planned, trueMin: trueOf(r, planned, speed.get(b.id)!),
        });
      }
      let cursor = r.int(10, 60);
      for (let k = r.int(0, 3); k > 0; k--) {
        const planned = r.pick(MENU);
        appointments.push({
          id: `a-${b.id}-${k}`, barberId: b.id, startInMin: cursor, plannedMin: planned,
          trueMin: trueOf(r, planned, speed.get(b.id)!), checkedIn: cursor <= 10 && r.chance(0.5),
        });
        cursor += planned + r.pick([0, 15, 30, 45, 60]);
      }
      if (r.chance(0.35)) {
        const from = r.int(-10, 120);
        breaks.push({ barberId: b.id, fromMin: from, toMin: from + r.pick([15, 30, 45]), label: "Break" });
      }
    }

    const tickets: SimTicket[] = [];
    for (let k = 1, m = r.int(1, 8); k <= m; k++) {
      const planned = r.pick(MENU);
      const pref = r.chance(0.3) ? r.pick(barbers).id : null;
      // Real duration depends on who actually cuts; the preferred barber's speed when known.
      const s = pref ? speed.get(pref)! : r.pick([...speed.values()]);
      tickets.push({ id: `t${k}`, number: k, preferredBarberId: pref, plannedMin: planned, trueMin: trueOf(r, planned, s) });
    }

    out.push({
      id: `gen-${String(i + 1).padStart(2, "0")}`, source: "generated", note: `seed ${seed} #${i + 1}`,
      barbers, inChair, tickets, appointments, breaks, bufferMin: r.chance(0.2) ? 10 : 0,
    });
  }
  return out;
}
