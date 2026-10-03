/**
 * Live queue estimator.
 *
 * Simulates every on-duty chair forward from "now":
 *   1. whoever is in the chair finishes (seated_at + duration, min 3 min left),
 *   2. customers already called for that chair go next,
 *   3. scheduled appointments are hard blocks the queue flows around,
 *   4. waiting tickets are placed in ticket order on their preferred barber,
 *      or on whichever eligible chair frees up first ("first available").
 *
 * Pure and deterministic, so the customer pass, the header pill and the desk
 * all show the same numbers from the same realtime rows.
 */
import { addMinutes, minutesBetween } from "./time";
import type { Barber, LiveAppointment, LiveBooking, LiveTicket } from "./types/domain";

export const MIN_REMAINING_MIN = 3;
/** A confirmed appointment that is this late is assumed not to be blocking the chair. */
export const LATE_GRACE_MIN = 15;
export const DEFAULT_WALK_IN_MIN = 30;

export interface QueueInput {
  now: Date;
  barbers: readonly Barber[];
  tickets: readonly LiveTicket[];
  appointments: readonly LiveAppointment[];
}

export type BarberLiveState = "available" | "in_chair" | "busy" | "off_duty";

export interface BarberLive {
  barberId: string;
  state: BarberLiveState;
  /** Minutes left on the current customer, when in chair. */
  minutesLeft: number | null;
  current: LiveBooking | null;
  called: LiveBooking | null;
  /** Wait for a brand-new standard walk-in that asks for this barber. */
  nextFreeMin: number | null;
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
  /** Estimate for a standard walk-in with "first available", or null when nobody is on duty. */
  nextWalkIn: WalkInEstimate | null;
}

interface Chair {
  barberId: string;
  sortOrder: number;
  freeAt: number;
  blocks: Array<{ start: number; end: number }>;
}

function isPendingHoldAlive(a: LiveAppointment, nowMs: number): boolean {
  return a.status !== "pending_payment" || (a.holdExpiresAt !== null && new Date(a.holdExpiresAt).getTime() > nowMs);
}

function buildChairs(input: QueueInput): Map<string, Chair> {
  const nowMs = input.now.getTime();
  const chairs = new Map<string, Chair>();

  for (const b of input.barbers) {
    if (!b.isOnDuty) continue;
    chairs.set(b.id, { barberId: b.id, sortOrder: b.sortOrder, freeAt: nowMs, blocks: [] });
  }

  const remainingMs = (seatedAt: string | null, durationMin: number) => {
    const seated = seatedAt ? new Date(seatedAt).getTime() : nowMs;
    const end = seated + durationMin * 60000;
    return Math.max(MIN_REMAINING_MIN * 60000, end - nowMs);
  };

  // 1. in chair
  for (const t of input.tickets) {
    if (t.status !== "in_chair" || !t.barberId) continue;
    const chair = chairs.get(t.barberId);
    if (chair) chair.freeAt = Math.max(chair.freeAt, nowMs + remainingMs(t.seatedAt, t.durationMin));
  }
  for (const a of input.appointments) {
    if (a.status !== "in_chair") continue;
    const chair = chairs.get(a.barberId);
    if (chair) chair.freeAt = Math.max(chair.freeAt, nowMs + remainingMs(a.seatedAt, a.durationMin));
  }

  // 2. already called for a chair
  const called: LiveBooking[] = [
    ...input.tickets.filter((t) => t.status === "called" && t.barberId),
    ...input.appointments.filter((a) => a.status === "called"),
  ];
  for (const c of called) {
    const chair = c.barberId ? chairs.get(c.barberId) : undefined;
    if (chair) chair.freeAt += c.durationMin * 60000;
  }

  // 3. scheduled appointments become blocks
  for (const a of input.appointments) {
    if (!(a.status === "confirmed" || a.status === "checked_in" || a.status === "pending_payment")) continue;
    if (!isPendingHoldAlive(a, nowMs)) continue;
    const chair = chairs.get(a.barberId);
    if (!chair) continue;
    const start = new Date(a.startsAt).getTime();
    if (start < nowMs - LATE_GRACE_MIN * 60000) continue; // very late: likely a no-show, don't hold the chair
    // A slightly late customer still gets their full service once they arrive.
    const blockStart = Math.max(start, nowMs);
    const blockEnd = start < nowMs ? nowMs + a.durationMin * 60000 : new Date(a.endsAt).getTime();
    chair.blocks.push({ start: blockStart, end: blockEnd });
  }
  for (const chair of chairs.values()) chair.blocks.sort((x, y) => x.start - y.start);

  return chairs;
}

/** Earliest start >= chair.freeAt where `durationMin` fits between blocks. */
function place(chair: Chair, durationMin: number): number {
  const dur = durationMin * 60000;
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
  const onDuty = new Set(chairs.keys());
  const line = waitingLine(input.tickets);
  const etas = new Map<string, TicketEta>();

  line.forEach((ticket, index) => {
    const pick = pickChair(candidateChairs(chairs, ticket.preferredBarberId), ticket.durationMin);
    const aheadCount = line
      .slice(0, index)
      .filter((other) => competes(other.preferredBarberId, ticket.preferredBarberId, onDuty)).length;
    if (!pick) {
      etas.set(ticket.id, { ticketId: ticket.id, position: index + 1, aheadCount, barberId: null, startsAt: null, waitMin: null });
      return;
    }
    pick.chair.freeAt = pick.start + ticket.durationMin * 60000;
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
    const pick = pickChair(candidateChairs(chairs, extra.preferredBarberId), extra.durationMin);
    if (pick && (!extra.preferredBarberId || onDuty.has(extra.preferredBarberId))) {
      extraEstimate = {
        barberId: pick.chair.barberId,
        startsAt: new Date(pick.start),
        waitMin: Math.max(0, Math.round(minutesBetween(input.now, new Date(pick.start)))),
        aheadCount: line.filter((t) => competes(t.preferredBarberId, extra.preferredBarberId, onDuty)).length,
      };
    }
  }

  return { etas, onDuty, line, extraEstimate };
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
  const { etas, onDuty, line, extraEstimate } = simulate(input, {
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
    if (current) {
      const seated = current.seatedAt ? new Date(current.seatedAt).getTime() : nowMs;
      minutesLeft = Math.max(0, Math.ceil((seated + current.durationMin * 60000 - nowMs) / 60000));
    }

    const nextFree = onDuty.has(b.id) ? estimateWalkIn(input, DEFAULT_WALK_IN_MIN, b.id) : null;
    let state: BarberLiveState;
    if (current) state = "in_chair";
    else if (!b.isOnDuty) state = "off_duty";
    else if (!called && nextFree !== null && nextFree.waitMin <= 1) state = "available";
    else state = "busy";

    barbers.set(b.id, {
      barberId: b.id,
      state,
      minutesLeft,
      current,
      called,
      nextFreeMin: nextFree ? nextFree.waitMin : null,
    });
  }

  return {
    now: input.now,
    onDutyIds: [...onDuty],
    waiting: line,
    barbers,
    etas,
    nextWalkIn: extraEstimate,
  };
}

/** Customer-facing label for the barber status badge. */
export function barberStatusLabel(live: BarberLive | undefined): string {
  if (!live) return "Off Duty";
  switch (live.state) {
    case "available":
      return "Available Now";
    case "in_chair":
      return `In Chair · ${live.minutesLeft ?? 0}m left`;
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
