import { describe, expect, it } from "vitest";
import { barberStatusLabel, buildQueueSnapshot, estimateWalkIn } from "./queue";
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
    checkedInAt: null, notifiedAt: null, calledAt: null, seatedAt: null, completedAt: null,
    createdAt: minutesAgo(30), ...partial,
  };
}

function appt(id: string, barberId: string, startIn: number, duration: number, status: LiveAppointment["status"] = "confirmed"): LiveAppointment {
  return {
    id, kind: "appointment", barberId, startsAt: minutesFromNow(startIn), endsAt: minutesFromNow(startIn + duration),
    durationMin: duration, priceCents: 4500, serviceSummary: "Cut", displayName: "Guest", status,
    paymentOption: "cash_on_site", paymentStatus: "unpaid", amountDueNowCents: 0, holdExpiresAt: null,
    checkedInAt: null, calledAt: null, seatedAt: null, completedAt: null,
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
