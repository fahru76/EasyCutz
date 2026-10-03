import { describe, expect, it } from "vitest";
import { defaultClosureMessage, formatReopen, overlapsClosure, reopenOptions } from "./closure";
import { closureAppointmentMessage, closureTicketMessage } from "./notify";
import { isShopClosed, type Shift } from "./types/domain";

const TZ = "Asia/Kuala_Lumpur";
// Open 10:00–21:00 every day except Monday (weekday 1), like the seed roster.
const shifts: Shift[] = [0, 2, 3, 4, 5, 6].map((weekday) => ({ barberId: "a", weekday, startMin: 600, endMin: 1260 }));

describe("reopenOptions", () => {
  it("offers +1h, +2h, rest of today and next opening", () => {
    const now = new Date("2026-10-03T15:00:00+08:00"); // Saturday
    const opts = reopenOptions(now, TZ, shifts);
    expect(opts.map((o) => o.id)).toEqual(["1h", "2h", "end_of_day", "next_opening"]);
    expect(opts.find((o) => o.id === "end_of_day")?.until.toISOString()).toBe("2026-10-03T13:00:00.000Z");
    expect(opts.find((o) => o.id === "next_opening")?.until.toISOString()).toBe("2026-10-04T02:00:00.000Z");
  });

  it("drops an end of day that is under 5 minutes away and skips closed days", () => {
    const now = new Date("2026-10-04T20:58:00+08:00"); // Sunday, Monday closed
    const opts = reopenOptions(now, TZ, shifts);
    expect(opts.map((o) => o.id)).toEqual(["1h", "2h", "next_opening"]);
    expect(opts.at(-1)?.until.toISOString()).toBe("2026-10-06T02:00:00.000Z"); // Tue 10:00
  });
});

describe("formatReopen", () => {
  const now = new Date("2026-10-03T15:00:00+08:00");
  it("uses today / tomorrow wording", () => {
    expect(formatReopen("2026-10-03T18:00:00+08:00", TZ, now)).toMatch(/^today at 6:00/i);
    expect(formatReopen("2026-10-04T10:00:00+08:00", TZ, now)).toMatch(/^tomorrow at 10:00/i);
    expect(formatReopen("2026-10-06T10:00:00+08:00", TZ, now)).toMatch(/Tue 6 Oct/);
  });
});

describe("closure state", () => {
  it("is closed only while now < closedUntil", () => {
    const now = new Date("2026-10-03T15:00:00+08:00");
    expect(isShopClosed({ closedUntil: null }, now)).toBe(false);
    expect(isShopClosed({ closedUntil: "2026-10-03T16:00:00+08:00" }, now)).toBe(true);
    expect(isShopClosed({ closedUntil: "2026-10-03T14:59:00+08:00" }, now)).toBe(false);
  });

  it("detects overlap with half-open windows", () => {
    const closure = { startsAt: "2026-10-03T15:00:00+08:00", endsAt: "2026-10-03T18:00:00+08:00" };
    expect(overlapsClosure({ startsAt: "2026-10-03T17:40:00+08:00", endsAt: "2026-10-03T18:20:00+08:00" }, closure)).toBe(true);
    expect(overlapsClosure({ startsAt: "2026-10-03T18:00:00+08:00", endsAt: "2026-10-03T18:40:00+08:00" }, closure)).toBe(false);
    expect(overlapsClosure({ startsAt: "2026-10-03T14:20:00+08:00", endsAt: "2026-10-03T15:00:00+08:00" }, closure)).toBe(false);
  });
});

describe("closure messages", () => {
  it("prefills a reason-specific message", () => {
    expect(defaultClosureMessage("power", "today at 6:00 pm")).toBe(
      "There's a power cut at the shop. We expect to reopen today at 6:00 pm. Sorry for the trouble!",
    );
  });

  it("tells a walk-in their ticket was cancelled, with refund note and booking link", () => {
    const text = closureTicketMessage({
      shopName: "EasyCutz",
      customerName: "Ali Hassan",
      code: "W-7",
      shopMessage: "Power cut.",
      reopensAt: "tomorrow at 10:00 am",
      bookUrl: "https://shop.example/",
      refund: true,
    });
    expect(text).toContain("Hi Ali,");
    expect(text).toContain("W-7 has been cancelled");
    expect(text).toContain("will be refunded");
    expect(text).toContain("https://shop.example/");
  });

  it("lists held times for a booked customer, or asks them to pick", () => {
    const withOffers = closureAppointmentMessage({
      shopName: "EasyCutz",
      customerName: "Farah",
      bookedTime: "Sat 3 Oct · 4:00 pm",
      shopMessage: "Power cut.",
      options: ["Sun 4 Oct · 10:00 am · Aiman", "Sun 4 Oct · 11:00 am · Bryan"],
      holdUntil: "Sun 4 Oct · 3:00 pm",
      passUrl: "https://shop.example/pass/abc",
    });
    expect(withOffers).toContain("1) Sun 4 Oct · 10:00 am · Aiman\n2) Sun 4 Oct · 11:00 am · Bryan");
    expect(withOffers).toContain("https://shop.example/pass/abc?reschedule=1");
    const none = closureAppointmentMessage({
      shopName: "EasyCutz",
      customerName: "Farah",
      bookedTime: "Sat 3 Oct · 4:00 pm",
      shopMessage: "Power cut.",
      options: [],
      holdUntil: null,
      passUrl: "https://shop.example/pass/abc",
    });
    expect(none).toContain("Please pick a new time here: https://shop.example/pass/abc?reschedule=1");
  });
});
