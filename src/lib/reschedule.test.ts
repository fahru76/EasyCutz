import { describe, expect, it } from "vitest";
import { rankRescheduleProposals, type RescheduleCandidate } from "./reschedule";

const at = (date: string, hhmm: string, barberId: string): RescheduleCandidate => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return { startsAt: `${date}T${hhmm}:00+08:00`, barberId, date, localMinute: h * 60 + m };
};
const original = { startsAt: "2026-10-06T14:00:00+08:00", barberId: "aiman", date: "2026-10-06", localMinute: 14 * 60 };

const pool: RescheduleCandidate[] = [
  at("2026-10-06", "11:00", "aiman"), // same day, earlier
  at("2026-10-06", "14:00", "aiman"), // the booking itself
  at("2026-10-06", "14:00", "bryan"), // other barber, same time
  at("2026-10-06", "15:00", "aiman"),
  at("2026-10-06", "15:15", "aiman"),
  at("2026-10-06", "16:30", "aiman"),
  at("2026-10-07", "14:15", "aiman"),
  at("2026-10-07", "10:00", "aiman"),
  at("2026-10-06", "15:00", "bryan"),
  at("2026-10-05", "14:00", "aiman"), // the day before: never
];

const label = (c: RescheduleCandidate) => `${c.date.slice(8)} ${String(Math.floor(c.localMinute / 60)).padStart(2, "0")}:${String(c.localMinute % 60).padStart(2, "0")} ${c.barberId}`;

describe("rankRescheduleProposals", () => {
  it("default: same barber later today, then same barber next day near the original time, spread out", () => {
    const out = rankRescheduleProposals(pool, original, { reason: "manual" });
    expect(out.map(label)).toEqual(["06 15:00 aiman", "06 16:30 aiman", "07 14:15 aiman"]);
  });

  it("delay: keeps the original time with a free barber first", () => {
    const out = rankRescheduleProposals(pool, original, { reason: "delay" });
    expect(out.map(label)[0]).toBe("06 14:00 bryan");
    expect(out.map(label).slice(1)).toEqual(["06 15:00 aiman", "06 16:30 aiman"]);
  });

  it("barber unavailable: never proposes the original barber", () => {
    const out = rankRescheduleProposals(pool, original, { reason: "barber_unavailable" });
    expect(out.every((c) => c.barberId !== "aiman")).toBe(true);
    expect(out.map(label)).toEqual(["06 14:00 bryan", "06 15:00 bryan"]);
  });

  it("early: same barber, earlier the same day, earliest first", () => {
    const out = rankRescheduleProposals(pool, original, { reason: "early", limit: 2 });
    expect(out.map(label)).toEqual(["06 11:00 aiman"]);
  });

  it("never proposes the current booking or past days, and respects the limit", () => {
    const out = rankRescheduleProposals(pool, original, { reason: "manual", limit: 10, minSpreadMin: 0 });
    expect(out.map(label)).not.toContain("06 14:00 aiman");
    expect(out.map(label)).not.toContain("05 14:00 aiman");
    expect(rankRescheduleProposals(pool, original, { reason: "manual", limit: 1 })).toHaveLength(1);
  });
});
