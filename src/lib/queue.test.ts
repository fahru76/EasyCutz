import { describe, expect, it } from "vitest";
import { barberStatusLabel, buildQueueSnapshot, estimateFinish, estimateWalkIn } from "./queue";
import type { Barber, LiveAppointment, LiveTicket } from "./types/domain";

const now = new Date("2026-10-06T06:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60000).toISOString();

function barber(id: string, sortOrder: number, isOnDuty = true): Barber {
  return {
    id, slug: id, displayName: id, specialty: "", bio: "", avatarUrl: null, rating: 5, reviewCount: 0,
    ticketPrefix: id.toUpperCase(), isOnDuty, sortOrder,
  };
}

function ticket(n: number, partial: Partial<LiveTicket> = {}): LiveTicket {
  return {
    id: `t${n}`, kind: "ticket", shopDay: "2026-10-06", ticketNumber: n, code: `W-${n}`,
    preferredBarberId: null, barberId: null, status: "waiting", durationMin: 30, priceCents: 4500,
    serviceSummary: "Cut", displayName: "Guest", paymentOption: "cash_on_site", paymentStatus: "unpaid",
    checkedInAt: null, notifiedAt: null, expectedEndAt: null, calledAt: null, seatedAt: null, completedAt: null,
    createdAt: minutesAgo(30), ...partial,
  };
}

function appt(
  id: string,
  barberId: string,
  startIn: number,
  duration: number,
  status: LiveAppointment["status"] = "confirmed",
  partial: Partial<LiveAppointment> = {},
): LiveAppointment {
  return {
    id, kind: "appointment", barberId, startsAt: minutesFromNow(startIn), endsAt: minutesFromNow(startIn + duration),
    durationMin: duration, priceCents: 4500, serviceSummary: "Cut", displayName: "Guest", status,
    paymentOption: "cash_on_site", paymentStatus: "unpaid", amountDueNowCents: 0, holdExpiresAt: null,
    expectedEndAt: null, delayNotifiedAt: null, delayNotifiedMin: null, rescheduleRequestedAt: null, serviceIds: [], addonIds: [],
    checkedInAt: null, calledAt: null, seatedAt: null, completedAt: null, ...partial,
  };
}

describe("queue estimator", () => {
  it("returns zero wait for an empty shop", () => {
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1)], tickets: [], appointments: [] });
    expect(snap.nextWalkIn?.waitMin).toBe(0);
    expect(snap.barbers.get("a")?.state).toBe("available");
    expect(barberStatusLabel(snap.barbers.get("a"))).toBe("Available Now");
  });

  it("accounts for time left on the customer in the chair", () => {
    const tickets = [ticket(1, { status: "in_chair", barberId: "a", seatedAt: minutesAgo(15), durationMin: 30 })];
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1)], tickets, appointments: [] });
    expect(snap.barbers.get("a")?.minutesLeft).toBe(15);
    expect(barberStatusLabel(snap.barbers.get("a"))).toBe("In Chair · 15m left");
    expect(snap.nextWalkIn?.waitMin).toBe(15);
  });

  it("queues tickets in order and reports position + ahead count", () => {
    const tickets = [
      ticket(1, { status: "in_chair", barberId: "a", seatedAt: minutesAgo(20), durationMin: 30 }), // 10 left
      ticket(2),
      ticket(3),
    ];
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1)], tickets, appointments: [] });
    expect(snap.etas.get("t2")).toMatchObject({ position: 1, aheadCount: 0, waitMin: 10 });
    expect(snap.etas.get("t3")).toMatchObject({ position: 2, aheadCount: 1, waitMin: 40 });
    // a new walk-in: 2 ahead, ~70 min
    expect(estimateWalkIn({ now, barbers: [barber("a", 1)], tickets, appointments: [] }, 30, null)).toMatchObject({
      aheadCount: 2,
      waitMin: 70,
    });
  });

  it("spreads 'first available' tickets across chairs", () => {
    const tickets = [ticket(1), ticket(2), ticket(3)];
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1), barber("b", 2)], tickets, appointments: [] });
    expect(snap.etas.get("t1")).toMatchObject({ barberId: "a", waitMin: 0 });
    expect(snap.etas.get("t2")).toMatchObject({ barberId: "b", waitMin: 0 });
    expect(snap.etas.get("t3")?.waitMin).toBe(30);
  });

  it("flows walk-ins around scheduled appointments", () => {
    // Appointment in 20 minutes for 45 min: a 30-min walk-in can't fit before it.
    const appointments = [appt("x", "a", 20, 45)];
    const est = estimateWalkIn({ now, barbers: [barber("a", 1)], tickets: [], appointments }, 30, "a");
    expect(est?.waitMin).toBe(65);
    // A 15-min job fits before it.
    expect(estimateWalkIn({ now, barbers: [barber("a", 1)], tickets: [], appointments }, 15, "a")?.waitMin).toBe(0);
  });

  it("honours preferred barbers and ignores off-duty chairs", () => {
    const barbers = [barber("a", 1), barber("b", 2), barber("c", 3, false)];
    const tickets = [ticket(1, { preferredBarberId: "b" }), ticket(2, { preferredBarberId: "c" })];
    const snap = buildQueueSnapshot({ now, barbers, tickets, appointments: [] });
    expect(snap.etas.get("t1")?.barberId).toBe("b");
    // preferred barber went off duty -> treated as first available
    expect(snap.etas.get("t2")?.barberId).toBe("a");
    expect(snap.barbers.get("c")?.state).toBe("off_duty");
    expect(estimateWalkIn({ now, barbers, tickets, appointments: [] }, 30, "c")).toBeNull();
  });

  it("ignores expired payment holds and very late appointments", () => {
    const expired = { ...appt("x", "a", 0, 60, "pending_payment"), holdExpiresAt: minutesAgo(1) };
    const late = appt("y", "a", -40, 45);
    const est = estimateWalkIn({ now, barbers: [barber("a", 1)], tickets: [], appointments: [expired, late] }, 30, "a");
    expect(est?.waitMin).toBe(0);
  });

  it("returns null with nobody on duty", () => {
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1, false)], tickets: [ticket(1)], appointments: [] });
    expect(snap.nextWalkIn).toBeNull();
    expect(snap.etas.get("t1")?.waitMin).toBeNull();
  });
});

describe("EZ-011 service timing", () => {
  const A = [barber("a", 1)];
  const overrunning = (overMin: number, duration = 30) =>
    ticket(1, { status: "in_chair", barberId: "a", seatedAt: minutesAgo(duration + overMin), durationMin: duration });

  it("detects a service running over and keeps estimating a realistic remainder", () => {
    const snap = buildQueueSnapshot({ now, barbers: A, tickets: [overrunning(10)], appointments: [] });
    const live = snap.barbers.get("a");
    expect(live?.runningOverMin).toBe(10);
    expect(live?.minutesLeft).toBe(0);
    expect(barberStatusLabel(live)).toBe("In Chair · running late");
    // max(5 min, 25% of 30 = 8) -> 8 min still assumed
    expect(snap.nextWalkIn?.waitMin).toBe(8);
  });

  it("uses the desk-adjusted expected end (+10 / done in ~5)", () => {
    const extended = ticket(1, {
      status: "in_chair", barberId: "a", seatedAt: minutesAgo(30), durationMin: 30, expectedEndAt: minutesFromNow(10),
    });
    let snap = buildQueueSnapshot({ now, barbers: A, tickets: [extended], appointments: [] });
    expect(snap.barbers.get("a")).toMatchObject({ runningOverMin: 0, minutesLeft: 10 });
    expect(snap.nextWalkIn?.waitMin).toBe(10);

    const early = { ...extended, seatedAt: minutesAgo(5), expectedEndAt: minutesFromNow(5) };
    snap = buildQueueSnapshot({ now, barbers: A, tickets: [early], appointments: [] });
    expect(snap.nextWalkIn?.waitMin).toBe(5);
    expect(estimateFinish(early, now.getTime()).runningOverMin).toBe(0);
  });

  it("cascades an overrun through that barber's booked appointments", () => {
    // chair frees at +8; bookings at +5 (30m) and +35 (30m)
    const appointments = [appt("x", "a", 5, 30), appt("y", "a", 35, 30)];
    const snap = buildQueueSnapshot({ now, barbers: A, tickets: [overrunning(10)], appointments });
    expect(snap.appointmentEtas.get("x")).toMatchObject({ delayMin: 3 });
    expect(snap.appointmentEtas.get("x")?.projectedStart.toISOString()).toBe(minutesFromNow(8));
    expect(snap.appointmentEtas.get("y")).toMatchObject({ delayMin: 3 });
    expect(snap.barbers.get("a")?.nextAppointment?.appointmentId).toBe("x");
  });

  it("absorbs a delay when there is slack before the next booking", () => {
    const appointments = [appt("x", "a", 5, 30), appt("y", "a", 60, 30)];
    const snap = buildQueueSnapshot({ now, barbers: A, tickets: [overrunning(10)], appointments });
    expect(snap.appointmentEtas.get("y")?.delayMin).toBe(0);
  });

  it("never drops a checked-in customer whose booked time passed while the barber was busy (regression)", () => {
    const late = appt("x", "a", -20, 30, "checked_in", { checkedInAt: minutesAgo(25) });
    const snap = buildQueueSnapshot({ now, barbers: A, tickets: [overrunning(10), ticket(2)], appointments: [late] });
    const eta = snap.appointmentEtas.get("x");
    expect(eta).toBeDefined();
    expect(eta?.delayMin).toBe(28); // booked -20, chair free at +8
    // the walk-in queues behind the checked-in booking: 8 + 30
    expect(snap.etas.get("t2")?.waitMin).toBe(38);
  });

  it("keeps a late booking while the chair is busy even if not checked in, drops it once the chair is idle", () => {
    const late = appt("x", "a", -20, 30);
    expect(buildQueueSnapshot({ now, barbers: A, tickets: [overrunning(10)], appointments: [late] }).appointmentEtas.has("x")).toBe(true);
    expect(buildQueueSnapshot({ now, barbers: A, tickets: [], appointments: [late] }).appointmentEtas.has("x")).toBe(false);
  });

  it("keeps delays per barber", () => {
    const barbers = [barber("a", 1), barber("b", 2)];
    const appointments = [appt("x", "a", 5, 30), appt("z", "b", 5, 30)];
    const snap = buildQueueSnapshot({ now, barbers, tickets: [overrunning(10)], appointments });
    expect(snap.appointmentEtas.get("x")?.delayMin).toBe(3);
    expect(snap.appointmentEtas.get("z")?.delayMin).toBe(0);
  });

  it("reports a free-early gap and whether a waiting walk-in fits it", () => {
    const appointments = [appt("x", "a", 25, 45)];
    let snap = buildQueueSnapshot({ now, barbers: A, tickets: [ticket(1, { durationMin: 45 })], appointments });
    expect(snap.barbers.get("a")).toMatchObject({ freeGapMin: 25, gapFillable: false });

    snap = buildQueueSnapshot({ now, barbers: A, tickets: [ticket(1, { durationMin: 20 })], appointments });
    expect(snap.barbers.get("a")).toMatchObject({ freeGapMin: 25, gapFillable: true });

    // busy chair -> no free gap reported
    snap = buildQueueSnapshot({ now, barbers: A, tickets: [overrunning(0)], appointments });
    expect(snap.barbers.get("a")?.freeGapMin).toBeNull();
  });
});
