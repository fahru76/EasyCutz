/** Display + normalisation helpers shared by client and server. */

import type { Locale } from "@/i18n/config";
import { getMessages, interpolate } from "@/i18n";

const CURRENCY_SYMBOL: Record<string, string> = { myr: "RM", sgd: "S$", usd: "$" };

/** 4500 -> "RM 45" ; 4550 -> "RM 45.50" */
export function formatMoney(cents: number, currency = "myr"): string {
  const symbol = CURRENCY_SYMBOL[currency.toLowerCase()] ?? currency.toUpperCase();
  const value = cents / 100;
  const text = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
  return `${symbol} ${text}`;
}

/** 45 -> "45 min" ; 75 -> "1h 15m" ; 120 -> "2h" (BM: "1j 15m") */
export function formatDuration(minutes: number, locale: Locale = "en"): string {
  const u = getMessages(locale).common.units;
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return interpolate(u.min, { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? interpolate(u.hours, { h }) : interpolate(u.hoursMinutes, { h, m: rest });
}

/** Rounded wait string used on badges: 0 -> "Now", 7 -> "~7 min", 63 -> "~1h 5m" */
export function formatWait(minutes: number, locale: Locale = "en"): string {
  const w = getMessages(locale).common.wait;
  if (minutes <= 1) return w.now;
  return interpolate(w.approx, { duration: formatDuration(minutes, locale) });
}

/** Queue headline: "~25 mins wait • 2 ahead" (or "No wait • 0 ahead"). */
export function formatQueueLine(waitMin: number, ahead: number, locale: Locale = "en"): string {
  const w = getMessages(locale).common.wait;
  const wait = waitMin <= 1 ? w.noWait : interpolate(w.minsWait, { n: waitMin });
  return `${wait} • ${interpolate(w.ahead, { n: ahead })}`;
}

/**
 * Normalises a phone number to E.164. Malaysian local formats are accepted:
 *   "012-345 6789" -> "+60123456789",  "60123456789" -> "+60123456789"
 * Returns null when the input cannot be a valid E.164 number.
 */
export function normalizePhone(input: string, defaultCountryCode = "60"): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (!hasPlus) {
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
    } else if (digits.startsWith("0")) {
      digits = defaultCountryCode + digits.slice(1);
    } else if (!digits.startsWith(defaultCountryCode)) {
      digits = defaultCountryCode + digits;
    }
  }
  const e164 = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** "+60123456789" -> "+60 •••• 6789" */
export function maskPhone(e164: string): string {
  const tail = e164.slice(-4);
  const head = e164.slice(0, 3);
  return `${head} •••• ${tail}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
