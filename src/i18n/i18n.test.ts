import { describe, expect, it } from "vitest";
import { apiErrorMessage, dictionaries, interpolate } from "./index";
import { resolveLocale } from "./config";
import { formatClock, formatDayLabel, formatLongDate } from "@/lib/time";
import { formatDuration, formatQueueLine } from "@/lib/format";

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(path, v);
    else for (const [p, s] of leaves(v, path)) out.set(p, s);
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("EZ-010 dictionaries", () => {
  const en = leaves(dictionaries.en as unknown as Tree);
  const ms = leaves(dictionaries.ms as unknown as Tree);

  it("BM has exactly the English keys", () => {
    expect([...ms.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it("every key uses the same placeholders in both languages", () => {
    const mismatched = [...en].filter(([k, v]) => placeholders(v).join() !== placeholders(ms.get(k) ?? "").join());
    expect(mismatched.map(([k]) => k)).toEqual([]);
  });

  it("no empty strings", () => {
    const empty = [...en, ...ms].filter(([, v]) => v.trim() === "").map(([k]) => k);
    expect(empty).toEqual([]);
  });
});

describe("locale detection", () => {
  it("saved choice wins, then the browser, then English", () => {
    expect(resolveLocale("ms", "en-US,en")).toBe("ms");
    expect(resolveLocale(null, "ms-MY,ms;q=0.9,en;q=0.8")).toBe("ms");
    expect(resolveLocale(undefined, "fr-FR")).toBe("en");
    expect(resolveLocale("xx", null)).toBe("en");
  });
});

describe("localised formatting", () => {
  const tz = "Asia/Kuala_Lumpur";
  const at = new Date("2026-10-06T06:00:00Z"); // Tue 6 Oct, 2:00 pm in KL

  it("reads naturally in BM (ticket example: Selasa, 6 Oktober · 2:00 PTG)", () => {
    expect(formatLongDate(at, tz, "ms")).toBe("Selasa, 6 Oktober");
    expect(formatClock(at, tz, "ms")).toBe("2:00 PTG");
    expect(formatDayLabel("2026-10-07", "2026-10-06", "ms").weekday).toBe(dictionaries.ms.common.time.tomorrow);
  });

  it("keeps the English output unchanged by default", () => {
    expect(formatDuration(75)).toBe("1h 15m");
    expect(formatQueueLine(25, 2)).toBe("~25 mins wait • 2 ahead");
    expect(formatQueueLine(0, 0)).toBe("No wait • 0 ahead");
  });

  it("fills placeholders and maps API error codes", () => {
    expect(interpolate("{n} di hadapan", { n: 3 })).toBe("3 di hadapan");
    expect(apiErrorMessage(dictionaries.ms, { error: "slot_unavailable", message: "Someone…" })).toBe(
      dictionaries.ms.errors.slot_unavailable,
    );
    expect(apiErrorMessage(dictionaries.en, { error: "unknown_code", message: "Raw" })).toBe("Raw");
  });
});
