/**
 * Slot-engine eval: cases + a brute-force oracle written independently of
 * src/lib/slots.ts. The engine must offer EXACTLY the oracle's set (no unsafe
 * slot offered, no valid slot hidden).
 */
import type { BusyInterval } from "@/lib/slots";
import { localToUtc } from "@/lib/time";
import type { Break, Shift } from "@/lib/types/domain";
import { rng } from "./rng";

export const TZ = "Asia/Kuala_Lumpur";
export const DATE = "2026-10-06"; // Tuesday (weekday 2)
const WEEKDAY = 2;

export interface SlotCase {
  id: string;
  source: "edge" | "generated";
  note: string;
  durationMin: number;
  barberIds: string[];
  shifts: Shift[];
  busy: BusyInterval[];
  breaks: Break[];
  bufferMin: number;
  slotIntervalMin: number;
  minLeadMin: number;
  /** minutes after local midnight of DATE (negative = the day before) */
  nowLocalMin: number;
}

const local = (min: number) => localToUtc(DATE, 0, TZ).getTime() + min * 60_000;
const at = (min: number) => new Date(local(min));
const shift = (barberId: string, startMin: number, endMin: number): Shift => ({ barberId, weekday: WEEKDAY, startMin, endMin });
const brk = (barberId: string, startMin: number, endMin: number, weekday = WEEKDAY): Break => ({
  id: `${barberId}-${startMin}`, barberId, weekday, startMin, endMin, label: "Break",
});

/** Every valid (minute -> barbers) pair, by brute force over aligned starts. */
export function oracle(c: SlotCase): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const earliest = local(c.nowLocalMin + c.minLeadMin);
  for (const barberId of c.barberIds) {
    for (let m = 0; m < 24 * 60; m += c.slotIntervalMin) {
      const s = local(m);
      const e = s + c.durationMin * 60_000;
      if (s < earliest) continue;
      const inShift = c.shifts.some(
        (sh) => sh.barberId === barberId && sh.weekday === WEEKDAY && sh.startMin <= m && m + c.durationMin <= sh.endMin,
      );
      if (!inShift) continue;
      const hitsBreak = c.breaks.some(
        (b) => b.barberId === barberId && b.weekday === WEEKDAY && m < b.endMin && b.startMin < m + c.durationMin,
      );
      if (hitsBreak) continue;
      const buf = c.bufferMin * 60_000;
      const hitsBusy = c.busy.some((b) => {
        if (b.barberId !== barberId) return false;
        const bs = b.start.getTime();
        const be = b.end.getTime();
        return b.booking ? s < be + buf && bs < e + buf : s < be && bs < e;
      });
      if (hitsBusy) continue;
      out.set(m, [...(out.get(m) ?? []), barberId]);
    }
  }
  return out;
}

type EdgeInput = Pick<SlotCase, "id" | "note" | "durationMin" | "barberIds" | "shifts"> & Partial<SlotCase>;
const edge = (c: EdgeInput): SlotCase => ({
  source: "edge", nowLocalMin: -600, minLeadMin: 30, bufferMin: 0, slotIntervalMin: 15, breaks: [], busy: [], ...c,
});

export const SLOT_EDGE_CASES: SlotCase[] = [
  edge({ id: "slot-shift-end-exact", note: "a cut that ends exactly at shift end is offered", durationMin: 45, barberIds: ["a"], shifts: [shift("a", 600, 780)] }),
  edge({ id: "slot-misaligned-shift", note: "shift starting 10:05 with a 15-min grid starts at 10:15", durationMin: 30, barberIds: ["a"], shifts: [shift("a", 605, 720)] }),
  edge({
    id: "slot-break-boundaries", note: "EZ-003: ends at break start / starts at break end are fine", durationMin: 30, barberIds: ["a"],
    shifts: [shift("a", 600, 900)], breaks: [brk("a", 720, 765)],
  }),
  edge({
    id: "slot-break-other-day", note: "EZ-003: a Friday break doesn't block Tuesday", durationMin: 30, barberIds: ["a"],
    shifts: [shift("a", 600, 900)], breaks: [brk("a", 720, 765, 5)],
  }),
  edge({
    id: "slot-buffer", note: "EZ-003: 10-min buffer on both sides of a booking, none around time off", durationMin: 30, barberIds: ["a"],
    bufferMin: 10, shifts: [shift("a", 600, 900)],
    busy: [{ barberId: "a", start: at(660), end: at(690), booking: true }, { barberId: "a", start: at(780), end: at(810) }],
  }),
  edge({
    id: "slot-any-barber-merge", note: "first-available merges barbers per minute", durationMin: 30, barberIds: ["a", "b"],
    shifts: [shift("a", 600, 720), shift("b", 660, 780)], breaks: [brk("b", 690, 720)],
  }),
  edge({
    id: "slot-lead-time", note: "minimum notice hides the next 60 min", durationMin: 20, barberIds: ["a"],
    shifts: [shift("a", 600, 720)], nowLocalMin: 600, minLeadMin: 60,
  }),
  edge({
    id: "slot-midnight-shift", note: "shift to 23:59 never offers a cut crossing midnight", durationMin: 45, barberIds: ["a"],
    shifts: [shift("a", 1260, 1439)],
  }),
];

export const SLOT_GENERATED_SEED = 7310;
export function generatedSlotCases(seed = SLOT_GENERATED_SEED, count = 60): SlotCase[] {
  const r = rng(seed);
  const out: SlotCase[] = [];
  for (let i = 0; i < count; i++) {
    const barberIds = ["a", "b", "c"].slice(0, r.int(1, 3));
    const shifts: Shift[] = [];
    const breaks: Break[] = [];
    const busy: BusyInterval[] = [];
    for (const id of barberIds) {
      const start = r.pick([540, 600, 605, 660, 720]);
      if (r.chance(0.3)) {
        shifts.push(shift(id, start, 780), shift(id, 840, r.pick([1140, 1260, 1439])));
      } else {
        shifts.push(shift(id, start, r.pick([1080, 1140, 1260, 1439])));
      }
      if (r.chance(0.5)) {
        const b = r.int(11, 15) * 60 + r.pick([0, 15, 30, 45]);
        breaks.push(brk(id, b, b + r.pick([15, 30, 45, 105])));
      }
      for (let k = r.int(0, 5); k > 0; k--) {
        const s = r.int(9 * 60, 20 * 60);
        const interval: BusyInterval = { barberId: id, start: at(s), end: at(s + r.pick([20, 30, 45, 60, 70])) };
        if (r.chance(0.8)) interval.booking = true;
        busy.push(interval);
      }
    }
    out.push({
      id: `slot-gen-${String(i + 1).padStart(2, "0")}`, source: "generated", note: `seed ${seed} #${i + 1}`,
      durationMin: r.pick([20, 30, 40, 45, 60, 70, 95]), barberIds, shifts, busy, breaks,
      bufferMin: r.pick([0, 0, 5, 10]), slotIntervalMin: r.pick([10, 15, 15, 20, 30]),
      minLeadMin: r.pick([0, 30, 60]), nowLocalMin: r.chance(0.5) ? -600 : r.int(8 * 60, 16 * 60),
    });
  }
  return out;
}

export function nowOf(c: SlotCase): Date {
  return new Date(local(c.nowLocalMin));
}
