/**
 * EZ-001 emergency closure — pure helpers shared by the desk, home page and pass.
 */
import { addDays, formatClock, formatShortDateTime, localDateString, localToUtc, weekdayOf } from "./time";
import type { ClosureReason, Shift } from "./types/domain";

export interface ReopenOption {
  id: "1h" | "2h" | "end_of_day" | "next_opening";
  label: string;
  until: Date;
}

/** Earliest allowed reopen time (the database enforces the same 5-minute floor). */
export const MIN_CLOSURE_MIN = 5;

/**
 * Suggested reopen times: +1h, +2h, end of today's shifts, next opening.
 * Options that would end within MIN_CLOSURE_MIN of now are dropped.
 */
export function reopenOptions(now: Date, timezone: string, shifts: Shift[], horizonDays = 14): ReopenOption[] {
  const today = localDateString(now, timezone);
  const floor = now.getTime() + MIN_CLOSURE_MIN * 60_000;
  const options: ReopenOption[] = [
    { id: "1h", label: "1 hour", until: new Date(now.getTime() + 60 * 60_000) },
    { id: "2h", label: "2 hours", until: new Date(now.getTime() + 120 * 60_000) },
  ];

  const todays = shifts.filter((s) => s.weekday === weekdayOf(today));
  if (todays.length > 0) {
    const end = localToUtc(today, Math.max(...todays.map((s) => s.endMin)), timezone);
    if (end.getTime() > floor) options.push({ id: "end_of_day", label: "Rest of today", until: end });
  }

  for (let i = 1; i <= Math.min(horizonDays, 14); i += 1) {
    const day = addDays(today, i);
    const dayShifts = shifts.filter((s) => s.weekday === weekdayOf(day));
    if (dayShifts.length === 0) continue;
    const start = localToUtc(day, Math.min(...dayShifts.map((s) => s.startMin)), timezone);
    options.push({ id: "next_opening", label: `Until ${formatShortDateTime(start, timezone)}`, until: start });
    break;
  }

  return options.filter((o) => o.until.getTime() > floor);
}

/** "today at 6:00 pm", "tomorrow at 10:00 am" or "Thu 8 Oct · 10:00 am". */
export function formatReopen(until: Date | string, timezone: string, now: Date): string {
  const d = typeof until === "string" ? new Date(until) : until;
  const today = localDateString(now, timezone);
  const day = localDateString(d, timezone);
  if (day === today) return `today at ${formatClock(d, timezone)}`;
  if (day === addDays(today, 1)) return `tomorrow at ${formatClock(d, timezone)}`;
  return formatShortDateTime(d, timezone);
}

const REASON_COPY: Record<ClosureReason, string> = {
  power: "There's a power cut at the shop.",
  weather: "The shop is affected by flooding / bad weather.",
  illness: "Our barbers are unwell today.",
  emergency: "We've had an emergency at the shop.",
  other: "We've had to close unexpectedly.",
};

/** Pre-filled customer-facing message; the desk can edit it before closing. */
export function defaultClosureMessage(reason: ClosureReason, reopenLabel: string): string {
  return `${REASON_COPY[reason]} We expect to reopen ${reopenLabel}. Sorry for the trouble!`;
}

/** Whether a booking window [startsAt, endsAt) overlaps a closure window. */
export function overlapsClosure(
  booking: { startsAt: string; endsAt: string },
  closure: { startsAt: string; endsAt: string },
): boolean {
  return (
    new Date(booking.startsAt).getTime() < new Date(closure.endsAt).getTime() &&
    new Date(booking.endsAt).getTime() > new Date(closure.startsAt).getTime()
  );
}
