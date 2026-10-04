import { describe, expect, it } from "vitest";
import { barberStatusLabel, buildQueueSnapshot, chairBlocksForDay, estimateFinish, estimateWalkIn, type ChairBlock } from "./queue";
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
    checkedInAt: null, notifiedAt: null, cancelReason: null, expectedEndAt: null, calledAt: null, seatedAt: null, completedAt: null,
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

describe("queue estimator with breaks (EZ-003)", () => {
  // now = Tue 6 Oct 2026, 2:00 pm in Kuala Lumpur
  const block = (barberId: string, from: number, to: number, label = "Break"): ChairBlock => ({
    barberId,
    start: new Date(now.getTime() + from * 60000),
    end: new Date(now.getTime() + to * 60000),
    label,
  });

  it("shows a barber on a break with the time they are back", () => {
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1)], tickets: [], appointments: [], blocks: [block("a", -5, 20, "Lunch")] });
    const live = snap.barbers.get("a");
    expect(live?.state).toBe("on_break");
    expect(live?.onBreak?.label).toBe("Lunch");
    expect(barberStatusLabel(live, "Asia/Kuala_Lumpur")).toMatch(/^On Break · back 2:20/);
    expect(snap.nextWalkIn?.waitMin).toBe(20);
  });

  it("flows walk-ins around an upcoming break", () => {
    const input = { now, barbers: [barber("a", 1)], tickets: [], appointments: [], blocks: [block("a", 10, 40)] };
    expect(estimateWalkIn(input, 30, null)?.waitMin).toBe(40); // 30 min doesn't fit in the 10-min gap
    expect(estimateWalkIn(input, 10, null)?.waitMin).toBe(0); // 10 min fits before the break
    const snap = buildQueueSnapshot(input);
    expect(snap.barbers.get("a")?.nextBreak?.start.toISOString()).toBe(minutesFromNow(10));
  });

  it("sends first-available walk-ins to the chair that is not on a break", () => {
    const snap = buildQueueSnapshot({
      now,
      barbers: [barber("a", 1), barber("b", 2)],
      tickets: [ticket(1)],
      appointments: [],
      blocks: [block("a", -1, 30)],
    });
    expect(snap.etas.get("t1")?.barberId).toBe("b");
    expect(snap.etas.get("t1")?.waitMin).toBe(0);
  });

  it("pushes a booking that falls in a break and reports the delay", () => {
    const snap = buildQueueSnapshot({
      now,
      barbers: [barber("a", 1)],
      tickets: [],
      appointments: [appt("p1", "a", 15, 20)],
      blocks: [block("a", 10, 40)],
    });
    const eta = snap.appointmentEtas.get("p1");
    expect(eta?.projectedStart.toISOString()).toBe(minutesFromNow(40));
    expect(eta?.delayMin).toBe(25);
    // a break before the booking means no "free early" gap is offered
    expect(snap.barbers.get("a")?.freeGapMin).toBeNull();
  });

  it("keeps the buffer after each service", () => {
    const tickets = [ticket(1, { status: "in_chair", barberId: "a", seatedAt: minutesAgo(15), durationMin: 30 }), ticket(2)];
    const snap = buildQueueSnapshot({ now, barbers: [barber("a", 1)], tickets, appointments: [], bufferMin: 10 });
    expect(snap.etas.get("t2")?.waitMin).toBe(25); // 15 left + 10 buffer
    expect(snap.nextWalkIn?.waitMin).toBe(25 + 30 + 10);
  });

  it("builds today's chair blocks from recurring breaks and time off", () => {
    const blocks = chairBlocksForDay(
      now,
      "Asia/Kuala_Lumpur",
      [
        { id: "x", barberId: "a", weekday: 2, startMin: 13 * 60, endMin: 13 * 60 + 45, label: "Lunch" },
        { id: "y", barberId: "a", weekday: 5, startMin: 765, endMin: 870, label: "Friday prayers" },
      ],
      [{ barberId: "b", startsAt: minutesFromNow(0), endsAt: minutesFromNow(15), kind: "break", reason: "Break" }],
    );
    expect(blocks.map((b) => `${b.barberId}:${b.label}`)).toEqual(["a:Lunch", "b:Break"]);
    expect(blocks[0]?.start.toISOString()).toBe("2026-10-06T05:00:00.000Z");
  });
});

describe("estimator matches the desk's call-next rules (found by evals/)", () => {
  it("lets a later, shorter walk-in take a gap the first one doesn't fit", () => {
    // booking in 34 min (70 min long): 40-min t1 can't fit before it, 20-min t2 can
    const snap = buildQueueSnapshot({
      now,
      barbers: [barber("a", 1)],
      tickets: [ticket(1, { durationMin: 40 }), ticket(2, { durationMin: 20 })],
      appointments: [appt("p1", "a", 34, 70)],
    });
    expect(snap.etas.get("t2")?.waitMin).toBe(0);
    expect(snap.etas.get("t1")?.waitMin).toBe(104); // after the booking
  });

  it("serves a booking that starts before a break on time", () => {
    const snap = buildQueueSnapshot({
      now,
      barbers: [barber("a", 1)],
      tickets: [],
      appointments: [appt("p1", "a", 20, 30)],
      blocks: [{ barberId: "a", start: new Date(now.getTime() + 30 * 60000), end: new Date(now.getTime() + 60 * 60000), label: "Break" }],
    });
    expect(snap.appointmentEtas.get("p1")?.projectedStart.toISOString()).toBe(minutesFromNow(20));
    expect(snap.appointmentEtas.get("p1")?.delayMin).toBe(0);
  });
});
