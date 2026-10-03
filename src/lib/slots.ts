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

export const DAY_PARTS: readonly DayPart[] = ["morning", "afternoon", "evening"];

export interface TimeGridCell {
  /** minute within the hour (0, 15, 30, 45 for a 15-min interval) */
  minute: number;
  slot: TimeSlot | null;
}

export interface TimeGridRow {
  /** 0-23, shop-local */
  hour: number;
  cells: TimeGridCell[];
}

export interface TimeGridPart {
  part: DayPart;
  available: number;
  rows: TimeGridRow[];
}

/**
 * Compact picker layout: one row per hour, one column per interval step.
 * Hours between the first and last open slot of a day part are kept even when
 * fully booked, so the grid stays aligned and "taken" times read as gaps.
 */
export function buildTimeGrid(slots: readonly TimeSlot[], slotIntervalMin: number): TimeGridPart[] {
  const step = slotIntervalMin > 0 && 60 % slotIntervalMin === 0 ? slotIntervalMin : 15;
  const minutes = Array.from({ length: 60 / step }, (_, i) => i * step);
  const byMinute = new Map(slots.map((s) => [s.localMinute, s]));

  return DAY_PARTS.map((part) => {
    const inPart = slots.filter((s) => dayPartOf(s.localMinute) === part);
    if (inPart.length === 0) return { part, available: 0, rows: [] };
    const first = Math.floor(Math.min(...inPart.map((s) => s.localMinute)) / 60);
    const last = Math.floor(Math.max(...inPart.map((s) => s.localMinute)) / 60);
    const rows: TimeGridRow[] = [];
    for (let hour = first; hour <= last; hour++) {
      rows.push({
        hour,
        cells: minutes.map((minute) => {
          const slot = byMinute.get(hour * 60 + minute) ?? null;
          return { minute, slot: slot && dayPartOf(slot.localMinute) === part ? slot : null };
        }),
      });
    }
    return { part, available: inPart.length, rows };
  });
}
