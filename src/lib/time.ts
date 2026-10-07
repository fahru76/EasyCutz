/**
 * Timezone-safe helpers built on Intl only (no runtime dependency).
 * All "local" values refer to the shop's IANA timezone, never the browser's.
 */

import { intlLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    out[part.type] = part.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. +480 for Kuala Lumpur). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of `date` in the shop timezone. */
export function localDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday for a calendar date string (timezone-independent). */
export function weekdayOf(dateString: string): number {
  const [y, m, d] = dateString.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Converts a shop-local wall clock (date + minutes from midnight) to a UTC instant. */
export function localToUtc(dateString: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = dateString.split("-").map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  // Two passes resolve DST transitions for zones that have them.
  let guess = wallAsUtc - tzOffsetMinutes(new Date(wallAsUtc), timeZone) * 60000;
  guess = wallAsUtc - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

/** UTC bounds [start, end) of a shop-local calendar day. */
export function localDayBounds(dateString: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: localToUtc(dateString, 0, timeZone),
    end: localToUtc(addDays(dateString, 1), 0, timeZone),
  };
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60000;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function formatClock(date: Date | string, timeZone: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(typeof date === "string" ? new Date(date) : date);
}

export function formatMinuteOfDay(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

export function formatDayLabel(
  dateString: string,
  todayString: string,
  locale: Locale = "en",
): { weekday: string; day: string; month: string } {
  const words = getMessages(locale).common.time;
  const [y, m, d] = dateString.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday =
    dateString === todayString
      ? words.today
      : dateString === addDays(todayString, 1)
        ? words.tomorrow
        : new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" }).format(dt);
  return {
    weekday,
    day: String(d),
    month: new Intl.DateTimeFormat(intlLocale(locale), { month: "short", timeZone: "UTC" }).format(dt),
  };
}

export function formatLongDate(date: Date | string, timeZone: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(typeof date === "string" ? new Date(date) : date);
}

/** "Tue 6 Oct · 2:30 pm" (BM: "Sel 6 Okt · 2:30 PTG") in the shop timezone. */
export function formatShortDateTime(date: Date | string, timeZone: string, locale: Locale = "en"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = new Intl.DateTimeFormat(intlLocale(locale), { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${day.replace(",", "")} · ${formatClock(d, timeZone, locale)}`;
}
