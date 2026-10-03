/**
 * Slot engine for scheduled appointments.
 *
 * A slot is offered only when a barber can take the *entire* cumulative
 * duration of the cart inside one shift without touching another live booking
 * or time off. The database re-validates the same rules (book_appointment +
 * gist exclusion constraint), so this is a fast, honest preview.
 */
import { addMinutes, localToUtc, weekdayOf } from "./time";
import type { Shift, TimeSlot } from "./types/domain";

export interface BusyInterval {
  barberId: string;
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** Shop-local calendar date, YYYY-MM-DD */
  date: string;
  durationMin: number;
  /** Barbers that may take the booking (one for a named barber, all for "any"). */
  barberIds: readonly string[];
  shifts: readonly Shift[];
  busy: readonly BusyInterval[];
  now: Date;
  timezone: string;
  slotIntervalMin: number;
  minLeadMin: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function generateSlots(q: SlotQuery): TimeSlot[] {
  if (q.durationMin <= 0 || q.slotIntervalMin <= 0) return [];

  const weekday = weekdayOf(q.date);
  const earliest = addMinutes(q.now, q.minLeadMin).getTime();
  const busyByBarber = new Map<string, Array<{ start: number; end: number }>>();
  for (const b of q.busy) {
    const list = busyByBarber.get(b.barberId) ?? [];
    list.push({ start: b.start.getTime(), end: b.end.getTime() });
    busyByBarber.set(b.barberId, list);
  }

  const byMinute = new Map<number, { startsAt: Date; barberIds: string[] }>();

  for (const barberId of q.barberIds) {
    const shifts = q.shifts.filter((s) => s.barberId === barberId && s.weekday === weekday);
    const busy = busyByBarber.get(barberId) ?? [];

    for (const shift of shifts) {
      const first = Math.ceil(shift.startMin / q.slotIntervalMin) * q.slotIntervalMin;
      for (let minute = first; minute + q.durationMin <= shift.endMin; minute += q.slotIntervalMin) {
        const start = localToUtc(q.date, minute, q.timezone);
        const startMs = start.getTime();
        if (startMs < earliest) continue;
        const endMs = startMs + q.durationMin * 60000;
        if (busy.some((b) => overlaps(startMs, endMs, b.start, b.end))) continue;

        const entry = byMinute.get(minute) ?? { startsAt: start, barberIds: [] };
        if (!entry.barberIds.includes(barberId)) entry.barberIds.push(barberId);
        byMinute.set(minute, entry);
      }
    }
  }

  return [...byMinute.entries()]
    .sort(([a], [b]) => a - b)
    .map(([localMinute, entry]) => ({
      startsAt: entry.startsAt.toISOString(),
      localMinute,
      availableBarberIds: entry.barberIds,
    }));
}

/** Does any of `barberIds` work at all on this local date? (calendar availability) */
export function isWorkingDay(date: string, barberIds: readonly string[], shifts: readonly Shift[]): boolean {
  const weekday = weekdayOf(date);
  return shifts.some((s) => s.weekday === weekday && barberIds.includes(s.barberId));
}

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPartOf(localMinute: number): DayPart {
  if (localMinute < 12 * 60) return "morning";
  if (localMinute < 17 * 60) return "afternoon";
  return "evening";
}
