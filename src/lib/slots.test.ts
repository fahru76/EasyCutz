import { describe, expect, it } from "vitest";
import { buildTimeGrid, generateSlots, isWorkingDay } from "./slots";
import type { Shift } from "./types/domain";

const KL = "Asia/Kuala_Lumpur";
// Tuesday 2026-10-06, shifts 10:00-13:00
const shifts: Shift[] = [
  { barberId: "a", weekday: 2, startMin: 600, endMin: 780 },
  { barberId: "b", weekday: 2, startMin: 600, endMin: 780 },
];
const base = {
  date: "2026-10-06",
  shifts,
  timezone: KL,
  slotIntervalMin: 15,
  minLeadMin: 30,
  now: new Date("2026-10-01T00:00:00Z"),
};
const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00+08:00`);

describe("generateSlots", () => {
  it("only offers starts where the whole cart duration fits in the shift", () => {
    const slots = generateSlots({ ...base, durationMin: 45, barberIds: ["a"], busy: [] });
    expect(slots[0]?.startsAt).toBe(at("10:00").toISOString());
    // last start = 13:00 - 45 min = 12:15
    expect(slots.at(-1)?.startsAt).toBe(at("12:15").toISOString());
    expect(slots).toHaveLength(10);
  });

  it("blocks out windows overlapping existing bookings for the exact duration", () => {
    const busy = [{ barberId: "a", start: at("11:00"), end: at("11:30") }];
    const slots = generateSlots({ ...base, durationMin: 45, barberIds: ["a"], busy });
    const starts = slots.map((s) => s.startsAt);
    expect(starts).toContain(at("10:15").toISOString()); // 10:15-11:00 touches but doesn't overlap
    expect(starts).not.toContain(at("10:30").toISOString()); // 10:30-11:15 overlaps
    expect(starts).not.toContain(at("11:15").toISOString());
    expect(starts).toContain(at("11:30").toISOString());
  });

  it("merges barbers for 'first available'", () => {
    const busy = [{ barberId: "a", start: at("10:00"), end: at("13:00") }];
    const slots = generateSlots({ ...base, durationMin: 30, barberIds: ["a", "b"], busy });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.availableBarberIds.length === 1 && s.availableBarberIds[0] === "b")).toBe(true);
  });

  it("respects the minimum lead time", () => {
    const now = new Date(at("10:20").getTime());
    const slots = generateSlots({ ...base, now, durationMin: 30, barberIds: ["a"], busy: [] });
    expect(slots[0]?.startsAt).toBe(at("11:00").toISOString());
  });

  it("returns nothing on closed days", () => {
    expect(generateSlots({ ...base, date: "2026-10-05", durationMin: 30, barberIds: ["a"], busy: [] })).toEqual([]);
    expect(isWorkingDay("2026-10-05", ["a"], shifts)).toBe(false);
    expect(isWorkingDay("2026-10-06", ["a"], shifts)).toBe(true);
  });
});

describe("buildTimeGrid", () => {
  const slot = (localMinute: number) => ({ startsAt: `t${localMinute}`, localMinute, availableBarberIds: ["a"] });

  it("groups slots into day parts with one row per hour", () => {
    // 10:00, 10:30, 11:45 | 14:15 | 17:00, 19:45
    const grid = buildTimeGrid([600, 630, 705, 855, 1020, 1185].map(slot), 15);
    const [morning, afternoon, evening] = grid;
    expect(morning?.available).toBe(3);
    expect(morning?.rows.map((r) => r.hour)).toEqual([10, 11]);
    expect(morning?.rows[0]?.cells.map((c) => c.minute)).toEqual([0, 15, 30, 45]);
    expect(morning?.rows[0]?.cells.map((c) => c.slot !== null)).toEqual([true, false, true, false]);
    expect(afternoon?.rows.map((r) => r.hour)).toEqual([14]);
    // keeps the empty hours in between so taken times show as gaps
    expect(evening?.rows.map((r) => r.hour)).toEqual([17, 18, 19]);
    expect(evening?.rows[1]?.cells.every((c) => c.slot === null)).toBe(true);
  });

  it("returns empty parts when nothing is open and adapts to the interval", () => {
    const grid = buildTimeGrid([slot(780), slot(810)], 30);
    expect(grid[0]).toEqual({ part: "morning", available: 0, rows: [] });
    expect(grid[1]?.rows[0]?.cells.map((c) => c.minute)).toEqual([0, 30]);
  });
});
