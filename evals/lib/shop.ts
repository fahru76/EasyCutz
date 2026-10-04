/**
 * Eval scenario model + ground-truth "real shop" simulator.
 *
 * A scenario is the live state at `now` (who is in each chair, who is waiting,
 * who is booked, which breaks are coming). The estimator only sees PLANNED
 * durations. The simulator replays the rest of the day with TRUE durations and
 * the desk's dispatch rules, and reports when each customer actually started.
 *
 * The simulator is written independently of src/lib/queue.ts on purpose: it is
 * the yardstick, so it must not share the estimator's code (or its bugs).
 */
import type { ChairBlock, QueueInput } from "@/lib/queue";
import type { Barber, LiveAppointment, LiveTicket } from "@/lib/types/domain";

export const MIN = 60_000;
/** desk_call_next calls a booking this many minutes before its start. */
const DUE_WITHIN_MIN = 10;
export const NOW = new Date("2026-10-06T06:00:00Z"); // Tue 2:00 pm, Kuala Lumpur

export interface SimBarber {
  id: string;
  sortOrder: number;
  onDuty: boolean;
}
export interface SimInChair {
  barberId: string;
  kind: "ticket" | "appointment";
  id: string;
  /** minutes since seated */
  elapsedMin: number;
  plannedMin: number;
  trueMin: number;
}
export interface SimTicket {
  id: string;
  number: number;
  preferredBarberId: string | null;
  plannedMin: number;
  trueMin: number;
}
export interface SimAppointment {
  id: string;
  barberId: string;
  /** minutes from now (may be negative = already due) */
  startInMin: number;
  plannedMin: number;
  trueMin: number;
  checkedIn: boolean;
}
export interface SimBreak {
  barberId: string;
  /** minutes from now */
  fromMin: number;
  toMin: number;
  label: string;
}
export interface Scenario {
  id: string;
  /** "edge" = hand-written (incl. regressions); "generated" = seeded random */
  source: "edge" | "generated";
  note: string;
  barbers: SimBarber[];
  inChair: SimInChair[];
  tickets: SimTicket[];
  appointments: SimAppointment[];
  breaks: SimBreak[];
  bufferMin: number;
}

const at = (min: number) => new Date(NOW.getTime() + min * MIN);
const iso = (min: number) => at(min).toISOString();

// ---------------------------------------------------------------------------
// Scenario -> estimator input (planned information only)
// ---------------------------------------------------------------------------
export function toQueueInput(s: Scenario): QueueInput {
  const barbers: Barber[] = s.barbers.map((b) => ({
    id: b.id, slug: b.id, displayName: b.id, specialty: "", bio: "", avatarUrl: null, rating: 5,
    reviewCount: 0, ticketPrefix: b.id.slice(0, 1).toUpperCase(), isOnDuty: b.onDuty, sortOrder: b.sortOrder,
  }));

  const ticketBase = (id: string, number: number, plannedMin: number): LiveTicket => ({
    id, kind: "ticket", shopDay: "2026-10-06", ticketNumber: number, code: `W-${number}`,
    preferredBarberId: null, barberId: null, status: "waiting", durationMin: plannedMin, priceCents: 4500,
    serviceSummary: "Cut", displayName: "Guest", paymentOption: "cash_on_site", paymentStatus: "unpaid",
    checkedInAt: null, notifiedAt: null, cancelReason: null, expectedEndAt: null, calledAt: null, seatedAt: null,
    completedAt: null, createdAt: iso(-60),
  });
  const apptBase = (id: string, barberId: string, startIn: number, plannedMin: number): LiveAppointment => ({
    id, kind: "appointment", barberId, startsAt: iso(startIn), endsAt: iso(startIn + plannedMin),
    durationMin: plannedMin, priceCents: 4500, serviceSummary: "Cut", displayName: "Guest", status: "confirmed",
    paymentOption: "cash_on_site", paymentStatus: "unpaid", amountDueNowCents: 0, holdExpiresAt: null,
    expectedEndAt: null, delayNotifiedAt: null, delayNotifiedMin: null, rescheduleRequestedAt: null,
    serviceIds: [], addonIds: [], checkedInAt: null, calledAt: null, seatedAt: null, completedAt: null,
  });

  const tickets: LiveTicket[] = s.tickets.map((t) => ({
    ...ticketBase(t.id, t.number, t.plannedMin),
    preferredBarberId: t.preferredBarberId,
  }));
  const appointments: LiveAppointment[] = s.appointments.map((a) => ({
    ...apptBase(a.id, a.barberId, a.startInMin, a.plannedMin),
    status: a.checkedIn ? "checked_in" : "confirmed",
    checkedInAt: a.checkedIn ? iso(Math.min(a.startInMin, 0) - 5) : null,
  }));
  for (const c of s.inChair) {
    if (c.kind === "ticket") {
      tickets.push({
        ...ticketBase(c.id, 0, c.plannedMin),
        status: "in_chair", barberId: c.barberId, seatedAt: iso(-c.elapsedMin),
      });
    } else {
      appointments.push({
        ...apptBase(c.id, c.barberId, -c.elapsedMin, c.plannedMin),
        status: "in_chair", checkedInAt: iso(-c.elapsedMin - 5), seatedAt: iso(-c.elapsedMin),
      });
    }
  }

  const blocks: ChairBlock[] = s.breaks.map((b) => ({ barberId: b.barberId, start: at(b.fromMin), end: at(b.toMin), label: b.label }));
  return { now: NOW, barbers, tickets, appointments, blocks, bufferMin: s.bufferMin };
}

// ---------------------------------------------------------------------------
// Ground truth: replay the shop with true durations
// ---------------------------------------------------------------------------
export interface Actual {
  /** minutes from now when each waiting ticket / upcoming appointment really started */
  starts: Map<string, number>;
  /** who served each ticket */
  servedBy: Map<string, string>;
}

/**
 * Desk rules replayed from the SQL `desk_call_next` (EZ-003 version),
 * implemented from scratch here:
 *  - a chair frees when its customer's TRUE service ends (never before now),
 *    then the barber rests `bufferMin`;
 *  - nobody is called while the barber is on a break (barber_back_at);
 *  - a booking due within 10 minutes is called first, unless a break starts
 *    before its booked time (then it waits for its time / the break's end);
 *  - otherwise the oldest walk-in for this chair whose PLANNED length (+ rest
 *    buffer) fits before the chair's next booking and next break (the desk
 *    only knows plans);
 *  - otherwise the chair idles until the next event.
 */
export function simulate(s: Scenario): Actual {
  const starts = new Map<string, number>();
  const servedBy = new Map<string, string>();
  const buffer = s.bufferMin;
  const chairs = s.barbers
    .filter((b) => b.onDuty)
    .map((b) => {
      const cur = s.inChair.find((c) => c.barberId === b.id);
      // A cut that "really" ended already is only marked complete now.
      return { id: b.id, sortOrder: b.sortOrder, freeAt: cur ? Math.max(0, -cur.elapsedMin + cur.trueMin) + buffer : 0 };
    });
  const pendingTickets = [...s.tickets].sort((x, y) => x.number - y.number);
  const pendingAppts = [...s.appointments].sort((x, y) => x.startInMin - y.startInMin);
  const breaksOf = (id: string) => s.breaks.filter((b) => b.barberId === id).sort((x, y) => x.fromMin - y.fromMin);
  const onDutyIds = new Set(chairs.map((c) => c.id));
  const eligible = (t: SimTicket, chairId: string) =>
    t.preferredBarberId === null || t.preferredBarberId === chairId || !onDutyIds.has(t.preferredBarberId);

  for (let guard = 0; guard < 10_000; guard++) {
    const active = chairs.filter(
      (c) => pendingAppts.some((a) => a.barberId === c.id) || pendingTickets.some((t) => eligible(t, c.id)),
    );
    if (active.length === 0) break;
    active.sort((x, y) => x.freeAt - y.freeAt || x.sortOrder - y.sortOrder);
    const chair = active[0]!;
    const t = chair.freeAt;

    const inBreak = breaksOf(chair.id).find((b) => b.fromMin <= t && t < b.toMin);
    if (inBreak) {
      chair.freeAt = inBreak.toMin;
      continue;
    }

    const due = pendingAppts.find(
      (a) =>
        a.barberId === chair.id &&
        a.startInMin <= t + DUE_WITHIN_MIN &&
        // never pull a booked customer forward into the barber's break
        !breaksOf(chair.id).some((b) => b.fromMin > t && b.fromMin < a.startInMin),
    );
    if (due) {
      starts.set(due.id, t);
      chair.freeAt = t + due.trueMin + buffer;
      pendingAppts.splice(pendingAppts.indexOf(due), 1);
      continue;
    }

    const nextAppt = pendingAppts.find((a) => a.barberId === chair.id);
    const nextBreak = breaksOf(chair.id).find((b) => b.fromMin > t);
    const limit = Math.min(nextAppt?.startInMin ?? Infinity, nextBreak?.fromMin ?? Infinity);
    // planned cut + rest buffer must fit before the next booking / break
    const ticket = pendingTickets.find((x) => eligible(x, chair.id) && t + x.plannedMin + buffer <= limit);
    if (ticket) {
      starts.set(ticket.id, t);
      servedBy.set(ticket.id, chair.id);
      chair.freeAt = t + ticket.trueMin + buffer;
      pendingTickets.splice(pendingTickets.indexOf(ticket), 1);
      continue;
    }

    // Idle until something changes for this chair.
    const candidates = [nextAppt ? nextAppt.startInMin - DUE_WITHIN_MIN : undefined, nextBreak?.toMin].filter(
      (v): v is number => v !== undefined && v > t,
    );
    const othersFree = chairs.filter((c) => c !== chair && c.freeAt > t).map((c) => c.freeAt);
    chair.freeAt = Math.min(...candidates, ...othersFree, t + 5);
  }
  return { starts, servedBy };
}
