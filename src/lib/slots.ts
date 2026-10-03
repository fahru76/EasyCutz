/**
 * Slot engine for scheduled appointments.
 *
 * A slot is offered only when a barber can take the *entire* cumulative
 * duration of the cart inside one shift without touching another live booking,
 * time off or a recurring break (EZ-003), keeping `bufferMin` free after every
 * booking. The database re-validates the same rules (slot_conflict +
 * gist exclusion constraint), so this is a fast, honest preview.
 */
import { addMinutes, localToUtc, weekdayOf } from "./time";
import type { Break, Shift, TimeSlot } from "./types/domain";

export interface BusyInterval {
  barberId: string;
  start: Date;
  end: Date;
  /** A booking (appointment / held offer): the buffer applies on both sides of it. */
  booking?: boolean;
}

/** A recurring break placed on a concrete date. */
export interface BreakInterval {
  barberId: string;
  start: Date;
  end: Date;
  label: string;
}

/** Recurring breaks of `barberIds` on a shop-local date, as UTC intervals. */
export function breaksOnDate(
  date: string,
  timezone: string,
  breaks: readonly Break[],
  barberIds?: readonly string[],
): BreakInterval[] {
  const weekday = weekdayOf(date);
  return breaks
    .filter((b) => b.weekday === weekday && (!barberIds || barberIds.includes(b.barberId)))
    .map((b) => ({
      barberId: b.barberId,
      start: localToUtc(date, b.startMin, timezone),
      end: localToUtc(date, b.endMin, timezone),
      label: b.label,
    }));
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
  /** EZ-003: recurring weekly breaks. */
  breaks?: readonly Break[];
  /** EZ-003: minutes kept free after every booking. */
  bufferMin?: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function generateSlots(q: SlotQuery): TimeSlot[] {
  if (q.durationMin <= 0 || q.slotIntervalMin <= 0) return [];

  const weekday = weekdayOf(q.date);
  const earliest = addMinutes(q.now, q.minLeadMin).getTime();
  const bufferMs = Math.max(0, q.bufferMin ?? 0) * 60000;
  const busyByBarber = new Map<string, Array<{ start: number; end: number; booking: boolean }>>();
  const addBusy = (barberId: string, start: Date, end: Date, booking: boolean) => {
    const list = busyByBarber.get(barberId) ?? [];
    list.push({ start: start.getTime(), end: end.getTime(), booking });
    busyByBarber.set(barberId, list);
  };
  for (const b of q.busy) addBusy(b.barberId, b.start, b.end, b.booking === true);
  for (const b of breaksOnDate(q.date, q.timezone, q.breaks ?? [], q.barberIds)) addBusy(b.barberId, b.start, b.end, false);

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
        const clash = busy.some((b) =>
          b.booking
            ? overlaps(startMs, endMs + bufferMs, b.start, b.end + bufferMs)
            : overlaps(startMs, endMs, b.start, b.end),
        );
        if (clash) continue;

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
