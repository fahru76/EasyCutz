import { describe, expect, it } from "vitest";
import {
  addDays,
  isDateString,
  localDateString,
  localDayBounds,
  localToUtc,
  tzOffsetMinutes,
  weekdayOf,
  zonedParts,
} from "./time";

const KL = "Asia/Kuala_Lumpur";

describe("time helpers", () => {
  it("knows Kuala Lumpur is UTC+8", () => {
    expect(tzOffsetMinutes(new Date("2026-10-03T00:00:00Z"), KL)).toBe(480);
  });

  it("converts shop-local wall time to UTC", () => {
    expect(localToUtc("2026-10-06", 14 * 60, KL).toISOString()).toBe("2026-10-06T06:00:00.000Z");
    expect(localToUtc("2026-10-06", 0, KL).toISOString()).toBe("2026-10-05T16:00:00.000Z");
  });

  it("handles DST zones (New York spring-forward day)", () => {
    // 2026-03-08 10:00 EDT == 14:00Z
    expect(localToUtc("2026-03-08", 10 * 60, "America/New_York").toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });

  it("derives local date and parts", () => {
    const d = new Date("2026-10-03T17:30:00Z"); // 01:30 on the 4th in KL
    expect(localDateString(d, KL)).toBe("2026-10-04");
    expect(zonedParts(d, KL)).toMatchObject({ hour: 1, minute: 30, weekday: 0 });
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-10-06")).toBe(2);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-02-28")).toBe(true);
  });

  it("gives day bounds", () => {
    const { start, end } = localDayBounds("2026-10-06", KL);
    expect(start.toISOString()).toBe("2026-10-05T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-06T16:00:00.000Z");
  });
});
