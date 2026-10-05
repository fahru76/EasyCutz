/**
 * Live queue + chair timeline estimator (EZ-011).
 *
 * Every on-duty chair is projected forward from "now", per barber:
 *   1. the customer in the chair finishes at their expected end
 *      (desk-adjustable `expected_end_at`, else seated_at + duration). When that
 *      time has passed the service is "running over" and we assume
 *      max(5 min, 25% of the service) is still left;
 *   2. customers already called for that chair go next;
 *   3. booked appointments follow in order. Each projected start is
 *      max(booked start, when the chair is actually free), so an overrun
 *      cascades through that barber's bookings, and only that barber's;
 *   4. waiting walk-ins fill the gaps between projected appointments, on their
 *      preferred barber or on whichever eligible chair frees first.
 *
 * EZ-003: breaks (recurring + desk "Take a break" + time off) are fixed blocks
 * on a chair: nobody is projected into them, booked customers whose time falls
 * in a break are pushed past it, and `bufferAfterServiceMin` is kept after
 * every service.
 *
 * Pure and deterministic: the customer pass, the home page and the desk all
 * derive the same numbers from the same realtime rows.
 */
import { breaksOnDate } from "./slots";
import { addMinutes, formatClock, localDateString, minutesBetween } from "./time";
import type { Barber, Break, LiveAppointment, LiveBooking, LiveTicket, TimeOff } from "./types/domain";

/** Floor for "time left" on a service that is still within its expected end. */
export const MIN_REMAINING_MIN = 1;
/** When a service runs over: assume at least this much is still left… */
export const OVERRUN_MIN_REMAINING_MIN = 8;
/** …or this fraction of the planned duration, whichever is larger. */
export const OVERRUN_FRACTION = 0.25;
/** A booked customer who hasn't checked in this late, while the chair is free, is treated as a likely no-show. */
export const LATE_GRACE_MIN = 15;
export const DEFAULT_WALK_IN_MIN = 30;

const MIN = 60_000;

export interface QueueInput {
  now: Date;
  barbers: readonly Barber[];
  tickets: readonly LiveTicket[];
  appointments: readonly LiveAppointment[];
  /** EZ-003: breaks and time off as concrete intervals (see `chairBlocksForDay`). */
  blocks?: readonly ChairBlock[];
  /** EZ-003: rest/cleanup minutes kept free after each service. */
  bufferMin?: number;
}

/** A period a barber is away from the chair (EZ-003). */
export interface ChairBlock {
  barberId: string;
  start: Date;
  end: Date;
  label: string;
}

/** Today's recurring breaks plus time off/breaks overlapping today, as chair blocks. */
export function chairBlocksForDay(
  now: Date,
  timezone: string,
  breaks: readonly Break[],
  timeOff: readonly TimeOff[],
): ChairBlock[] {
  const today = localDateString(now, timezone);
  return [
    ...breaksOnDate(today, timezone, breaks),
    ...timeOff.map((t) => ({
      barberId: t.barberId,
      start: new Date(t.startsAt),
      end: new Date(t.endsAt),
      label: t.kind === "break" ? "Break" : t.reason || "Away",
    })),
  ];
}

export type BarberLiveState = "available" | "in_chair" | "busy" | "on_break" | "off_duty";

export interface AppointmentEta {
  appointmentId: string;
  barberId: string;
  bookedStart: Date;
  projectedStart: Date;
  /** Minutes the barber's chair is running behind for this booking (0 = on time). */
  delayMin: number;
}

export interface BarberLive {
  barberId: string;
  state: BarberLiveState;
  /** Minutes left on the current customer per the plan (0 once running over). */
  minutesLeft: number | null;
  /** Minutes the current service is past its expected end (0 when on time). */
  runningOverMin: number;
  /** Planned/adjusted end of the current service. */
  expectedEndAt: Date | null;
  current: LiveBooking | null;
  called: LiveBooking | null;
  /** Wait for a brand-new standard walk-in that asks for this barber. */
  nextFreeMin: number | null;
  /** This barber's next booked appointment (projected). */
  nextAppointment: AppointmentEta | null;
  /** Idle chair: free minutes before the next booking (null when busy or nothing booked). */
  freeGapMin: number | null;
  /** True when a waiting walk-in for this chair fits inside `freeGapMin`. */
  gapFillable: boolean;
  /** EZ-003: the break the barber is on right now. */
  onBreak: { until: Date; label: string } | null;
  /** EZ-003: the barber's next break today (not yet started). */
  nextBreak: { start: Date; end: Date; label: string } | null;
}

export interface TicketEta {
  ticketId: string;
  /** 1-based place in the overall waiting line. */
  position: number;
  /** Earlier waiting tickets competing for the same chair(s). */
  aheadCount: number;
  barberId: string | null;
  startsAt: Date | null;
  waitMin: number | null;
}

export interface WalkInEstimate {
  waitMin: number;
  aheadCount: number;
  barberId: string;
  startsAt: Date;
}

export interface QueueSnapshot {
  now: Date;
  onDutyIds: string[];
  waiting: LiveTicket[];
  barbers: Map<string, BarberLive>;
  etas: Map<string, TicketEta>;
  appointmentEtas: Map<string, AppointmentEta>;
  /** Estimate for a standard walk-in with "first available", or null when nobody is on duty. */
  nextWalkIn: WalkInEstimate | null;
}

// ---------------------------------------------------------------------------
// In-chair service timing
// ---------------------------------------------------------------------------
export interface ServiceFinish {
  /** End per plan (expected_end_at, else seated_at + duration). */
  plannedEnd: number;
  /** Best estimate of the real end (later than plannedEnd when running over). */
  estimatedEnd: number;
  runningOverMin: number;
}

export function estimateFinish(booking: LiveBooking, nowMs: number): ServiceFinish {
  const seated = booking.seatedAt ? new Date(booking.seatedAt).getTime() : nowMs;
  const plannedEnd = booking.expectedEndAt
    ? new Date(booking.expectedEndAt).getTime()
    : seated + booking.durationMin * MIN;

  if (plannedEnd > nowMs) {
    return { plannedEnd, estimatedEnd: Math.max(plannedEnd, nowMs + MIN_REMAINING_MIN * MIN), runningOverMin: 0 };
  }
  const guessMin = Math.max(OVERRUN_MIN_REMAINING_MIN, Math.round(booking.durationMin * OVERRUN_FRACTION));
  return {
    plannedEnd,
    estimatedEnd: nowMs + guessMin * MIN,
    runningOverMin: Math.floor((nowMs - plannedEnd) / MIN),
  };
}

// ---------------------------------------------------------------------------
// Chair timelines
// ---------------------------------------------------------------------------
interface Chair {
  barberId: string;
  sortOrder: number;
  /** When the chair is free after in-chair + called customers. */
  freeAt: number;
  /** Projected appointment intervals (+ buffer) and breaks walk-ins must flow around. */
  blocks: Array<{ start: number; end: number }>;
  /** Breaks / time off only (fixed, never moved). */
  breaks: Array<{ start: number; end: number }>;
  appointments: AppointmentEta[];
  busyNow: boolean;
}

function isPendingHoldAlive(a: LiveAppointment, nowMs: number): boolean {
  return a.status !== "pending_payment" || (a.holdExpiresAt !== null && new Date(a.holdExpiresAt).getTime() > nowMs);
}

/**
 * A booking whose START falls in a break waits until the barber is back.
 * One that starts before a break is served on time (the break moves), matching
 * the desk: desk_call_next never refuses a due booking because of a later break.
 */
function outOfBreaks(breaks: ReadonlyArray<{ start: number; end: number }>, start: number): number {
  let t = start;
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of breaks) {
      if (b.start <= t && t < b.end) {
        t = b.end;
        moved = true;
      }
    }
  }
  return t;
}

function buildChairs(input: QueueInput): Map<string, Chair> {
  const nowMs = input.now.getTime();
  const bufferMs = Math.max(0, input.bufferMin ?? 0) * MIN;
  const chairs = new Map<string, Chair>();

  for (const b of input.barbers) {
    if (!b.isOnDuty) continue;
    const breaks = (input.blocks ?? [])
      .filter((x) => x.barberId === b.id && x.end.getTime() > nowMs)
      .map((x) => ({ start: x.start.getTime(), end: x.end.getTime() }))
      .sort((x, y) => x.start - y.start);
    chairs.set(b.id, {
      barberId: b.id,
      sortOrder: b.sortOrder,
      freeAt: nowMs,
      blocks: [...breaks],
      breaks,
      appointments: [],
      busyNow: false,
    });
  }

  // 1. in chair
  const inChair: LiveBooking[] = [
    ...input.tickets.filter((t) => t.status === "in_chair" && t.barberId),
    ...input.appointments.filter((a) => a.status === "in_chair"),
  ];
  for (const b of inChair) {
    const chair = b.barberId ? chairs.get(b.barberId) : undefined;
    if (!chair) continue;
    chair.busyNow = true;
    chair.freeAt = Math.max(chair.freeAt, estimateFinish(b, nowMs).estimatedEnd + bufferMs);
  }

  // 2. already called for a chair
  const called: LiveBooking[] = [
    ...input.tickets.filter((t) => t.status === "called" && t.barberId),
    ...input.appointments.filter((a) => a.status === "called"),
  ];
  for (const c of called) {
    const chair = c.barberId ? chairs.get(c.barberId) : undefined;
    if (!chair) continue;
    chair.busyNow = true;
    chair.freeAt += c.durationMin * MIN + bufferMs;
  }

  // 3. booked appointments, projected in order per barber (delays cascade)
  const upcoming = input.appointments
    .filter((a) => a.status === "confirmed" || a.status === "checked_in" || a.status === "pending_payment")
    .filter((a) => isPendingHoldAlive(a, nowMs))
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt));

  for (const chair of chairs.values()) {
    let cursor = chair.freeAt;
    for (const a of upcoming) {
      if (a.barberId !== chair.barberId) continue;
      const booked = new Date(a.startsAt).getTime();
      // Bug fix (EZ-011): only drop a late booking when the customer hasn't checked in AND
      // the chair isn't the reason they're waiting. A checked-in customer is never dropped.
      const likelyNoShow = !a.checkedInAt && !chair.busyNow && booked < nowMs - LATE_GRACE_MIN * MIN;
      if (likelyNoShow) continue;

      const durMs = a.durationMin * MIN;
      // EZ-003: a booking that would start during a break waits until the barber is back.
      const chairReadyAt = outOfBreaks(chair.breaks, Math.max(booked, cursor));
      const projectedStart = outOfBreaks(chair.breaks, Math.max(chairReadyAt, nowMs));
      const projectedEnd = projectedStart + durMs;
      const delayMin = Math.max(0, Math.round((chairReadyAt - booked) / MIN));
      chair.appointments.push({
        appointmentId: a.id,
        barberId: chair.barberId,
        bookedStart: new Date(booked),
        projectedStart: new Date(projectedStart),
        delayMin,
      });
      chair.blocks.push({ start: projectedStart, end: projectedEnd + bufferMs });
      cursor = projectedEnd + bufferMs;
    }
  }

  return chairs;
}

/** Earliest start >= chair.freeAt where `durationMin` fits between blocks. */
function place(chair: Chair, durationMin: number): number {
  const dur = durationMin * MIN;
  let t = chair.freeAt;
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of chair.blocks) {
      if (t < b.end && b.start < t + dur) {
        t = b.end;
        moved = true;
      }
    }
  }
  return t;
}

function candidateChairs(chairs: Map<string, Chair>, preferredBarberId: string | null): Chair[] {
  if (preferredBarberId) {
    const preferred = chairs.get(preferredBarberId);
    if (preferred) return [preferred];
  }
  return [...chairs.values()];
}

function pickChair(candidates: Chair[], durationMin: number): { chair: Chair; start: number } | null {
  let best: { chair: Chair; start: number } | null = null;
  for (const chair of candidates) {
    const start = place(chair, durationMin);
    if (!best || start < best.start || (start === best.start && chair.sortOrder < best.chair.sortOrder)) {
      best = { chair, start };
    }
  }
  return best;
}

function waitingLine(tickets: readonly LiveTicket[]): LiveTicket[] {
  return tickets.filter((t) => t.status === "waiting").sort((a, b) => a.ticketNumber - b.ticketNumber);
}

function competes(a: string | null, b: string | null, onDuty: ReadonlySet<string>): boolean {
  const ea = a && onDuty.has(a) ? a : null;
  const eb = b && onDuty.has(b) ? b : null;
  return ea === null || eb === null || ea === eb;
}

function simulate(input: QueueInput, extra?: { durationMin: number; preferredBarberId: string | null }) {
  const chairs = buildChairs(input);
  const bufferMin = Math.max(0, input.bufferMin ?? 0);
  const onDuty = new Set(chairs.keys());
  const line = waitingLine(input.tickets);
  const etas = new Map<string, TicketEta>();

  // Snapshot of the timeline before walk-ins are placed (used for gaps / appointment ETAs).
  const appointmentEtas = new Map<string, AppointmentEta>();
  const freeAtBeforeWalkIns = new Map<string, number>();
  for (const chair of chairs.values()) {
    freeAtBeforeWalkIns.set(chair.barberId, chair.freeAt);
    for (const eta of chair.appointments) appointmentEtas.set(eta.appointmentId, eta);
  }

  line.forEach((ticket, index) => {
    const pick = pickChair(candidateChairs(chairs, ticket.preferredBarberId), ticket.durationMin + bufferMin);
    const aheadCount = line
      .slice(0, index)
      .filter((other) => competes(other.preferredBarberId, ticket.preferredBarberId, onDuty)).length;
    if (!pick) {
      etas.set(ticket.id, { ticketId: ticket.id, position: index + 1, aheadCount, barberId: null, startsAt: null, waitMin: null });
      return;
    }
    // The desk calls the oldest walk-in that FITS before the next booking/break, so a
    // later, shorter cut can take an earlier gap: keep placed walk-ins as blocks
    // instead of pushing the whole chair's free time forward.
    pick.chair.blocks.push({ start: pick.start, end: pick.start + (ticket.durationMin + bufferMin) * MIN });
    etas.set(ticket.id, {
      ticketId: ticket.id,
      position: index + 1,
      aheadCount,
      barberId: pick.chair.barberId,
      startsAt: new Date(pick.start),
      waitMin: Math.max(0, Math.round(minutesBetween(input.now, new Date(pick.start)))),
    });
  });

  let extraEstimate: WalkInEstimate | null = null;
  if (extra) {
    const pick = pickChair(candidateChairs(chairs, extra.preferredBarberId), extra.durationMin + bufferMin);
    if (pick && (!extra.preferredBarberId || onDuty.has(extra.preferredBarberId))) {
      extraEstimate = {
        barberId: pick.chair.barberId,
        startsAt: new Date(pick.start),
        waitMin: Math.max(0, Math.round(minutesBetween(input.now, new Date(pick.start)))),
        aheadCount: line.filter((t) => competes(t.preferredBarberId, extra.preferredBarberId, onDuty)).length,
      };
    }
  }

  return { chairs, etas, onDuty, line, extraEstimate, appointmentEtas, freeAtBeforeWalkIns };
}

/** Estimate for a hypothetical new walk-in (used before issuing a ticket). */
export function estimateWalkIn(
  input: QueueInput,
  durationMin: number,
  preferredBarberId: string | null,
): WalkInEstimate | null {
  return simulate(input, { durationMin: Math.max(1, durationMin), preferredBarberId }).extraEstimate;
}

export function buildQueueSnapshot(input: QueueInput): QueueSnapshot {
  const { chairs, etas, onDuty, line, extraEstimate, appointmentEtas, freeAtBeforeWalkIns } = simulate(input, {
    durationMin: DEFAULT_WALK_IN_MIN,
    preferredBarberId: null,
  });
  const nowMs = input.now.getTime();
  const barbers = new Map<string, BarberLive>();

  for (const b of input.barbers) {
    const current: LiveBooking | null =
      input.tickets.find((t) => t.status === "in_chair" && t.barberId === b.id) ??
      input.appointments.find((a) => a.status === "in_chair" && a.barberId === b.id) ??
      null;
    const called: LiveBooking | null =
      input.tickets.find((t) => t.status === "called" && t.barberId === b.id) ??
      input.appointments.find((a) => a.status === "called" && a.barberId === b.id) ??
      null;

    let minutesLeft: number | null = null;
    let runningOverMin = 0;
    let expectedEndAt: Date | null = null;
    if (current) {
      const finish = estimateFinish(current, nowMs);
      minutesLeft = Math.max(0, Math.ceil((finish.plannedEnd - nowMs) / MIN));
      runningOverMin = finish.runningOverMin;
      expectedEndAt = new Date(finish.plannedEnd);
    }

    const chair = chairs.get(b.id);
    const nextAppointment = chair?.appointments[0] ?? null;

    // EZ-003: on a break now / next break today
    const myBlocks = (input.blocks ?? [])
      .filter((x) => x.barberId === b.id && x.end.getTime() > nowMs)
      .sort((x, y) => x.start.getTime() - y.start.getTime());
    const activeBlocks = myBlocks.filter((x) => x.start.getTime() <= nowMs);
    const onBreak = activeBlocks.length
      ? {
          until: new Date(Math.max(...activeBlocks.map((x) => x.end.getTime()))),
          label: activeBlocks[0]!.label,
        }
      : null;
    const upcomingBlock = myBlocks.find((x) => x.start.getTime() > nowMs) ?? null;
    const nextBreak = upcomingBlock ? { start: upcomingBlock.start, end: upcomingBlock.end, label: upcomingBlock.label } : null;

    // Free-early gap: idle chair with time to spare before the next booking.
    let freeGapMin: number | null = null;
    let gapFillable = false;
    // A break before the next booking means the chair isn't free in between.
    const breakFirst = nextBreak !== null && nextAppointment !== null && nextBreak.start < nextAppointment.projectedStart;
    if (chair && !current && !called && !onBreak && !breakFirst && nextAppointment) {
      const freeFrom = Math.max(nowMs, freeAtBeforeWalkIns.get(b.id) ?? nowMs);
      const gap = Math.floor((nextAppointment.projectedStart.getTime() - freeFrom) / MIN);
      if (gap > 0) {
        freeGapMin = gap;
        gapFillable = line.some(
          (t) => competes(t.preferredBarberId, b.id, onDuty) && t.durationMin <= gap,
        );
      }
    }

    const nextFree = onDuty.has(b.id) ? estimateWalkIn(input, DEFAULT_WALK_IN_MIN, b.id) : null;
    let state: BarberLiveState;
    if (current) state = "in_chair";
    else if (!b.isOnDuty) state = "off_duty";
    else if (onBreak) state = "on_break";
    else if (!called && nextFree !== null && nextFree.waitMin <= 1) state = "available";
    else state = "busy";

    barbers.set(b.id, {
      barberId: b.id,
      state,
      minutesLeft,
      runningOverMin,
      expectedEndAt,
      current,
      called,
      nextFreeMin: nextFree ? nextFree.waitMin : null,
      nextAppointment,
      freeGapMin,
      gapFillable,
      onBreak,
      nextBreak,
    });
  }

  return {
    now: input.now,
    onDutyIds: [...onDuty],
    waiting: line,
    barbers,
    etas,
    appointmentEtas,
    nextWalkIn: extraEstimate,
  };
}

/** Customer-facing label for the barber status badge. */
export function barberStatusLabel(live: BarberLive | undefined, timezone = "Asia/Kuala_Lumpur"): string {
  if (!live) return "Off Duty";
  switch (live.state) {
    case "on_break":
      return live.onBreak ? `On Break · back ${formatClock(live.onBreak.until, timezone)}` : "On Break";
    case "available":
      return "Available Now";
    case "in_chair":
      return live.runningOverMin > 0 ? "In Chair · running late" : `In Chair · ${live.minutesLeft ?? 0}m left`;
    case "busy":
      return live.nextFreeMin !== null ? `Free in ~${live.nextFreeMin}m` : "Busy";
    case "off_duty":
      return "Off Duty";
  }
}

/** Shifts an estimate into a wall-clock instant. */
export function etaClock(now: Date, waitMin: number): Date {
  return addMinutes(now, waitMin);
}
