import { describe, expect, it } from "vitest";
import { computeAmountDueNow, computeCartTotals, toggleId } from "./cart";
import { formatDuration, formatMoney, normalizePhone } from "./format";
import type { Addon, Service } from "./types/domain";

const services: Service[] = [
  { id: "s1", slug: "cut", name: "Signature Cut", description: "", category: "haircut", durationMin: 45, priceCents: 4500, isPopular: true, sortOrder: 1 },
  { id: "s2", slug: "beard", name: "Beard Sculpt", description: "", category: "beard_shave", durationMin: 20, priceCents: 2500, isPopular: false, sortOrder: 2 },
];
const addons: Addon[] = [
  { id: "a1", slug: "towel", name: "Hot Towel", description: "", durationMin: 5, priceCents: 800, sortOrder: 1 },
];
const settings = { depositPercent: 20, minDepositCents: 1000 };

describe("cart", () => {
  it("sums duration and price across services and add-ons", () => {
    const totals = computeCartTotals(services, addons, ["s1", "s2"], ["a1"]);
    expect(totals.durationMin).toBe(70);
    expect(totals.priceCents).toBe(7800);
    expect(totals.lines.map((l) => l.type)).toEqual(["service", "service", "addon"]);
  });

  it("ignores add-ons without a service and unknown ids", () => {
    expect(computeCartTotals(services, addons, [], ["a1"]).priceCents).toBe(0);
    expect(computeCartTotals(services, addons, ["nope"], []).lines).toHaveLength(0);
  });

  it("computes the amount due now like the database", () => {
    expect(computeAmountDueNow(7800, "deposit", settings)).toBe(1560);
    expect(computeAmountDueNow(4000, "deposit", settings)).toBe(1000);
    expect(computeAmountDueNow(800, "deposit", settings)).toBe(800);
    expect(computeAmountDueNow(7800, "full", settings)).toBe(7800);
    expect(computeAmountDueNow(7800, "cash_on_site", settings)).toBe(0);
  });

  it("toggles ids with a cap", () => {
    expect(toggleId(["a"], "a", 3)).toEqual([]);
    expect(toggleId(["a"], "b", 3)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });
});

describe("format", () => {
  it("formats money and durations", () => {
    expect(formatMoney(4500)).toBe("RM 45");
    expect(formatMoney(4550)).toBe("RM 45.50");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(75)).toBe("1h 15m");
    expect(formatDuration(120)).toBe("2h");
  });

  it("normalises Malaysian phone numbers to E.164", () => {
    expect(normalizePhone("012-345 6789")).toBe("+60123456789");
    expect(normalizePhone("60123456789")).toBe("+60123456789");
    expect(normalizePhone("+65 9123 4567")).toBe("+6591234567");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});
