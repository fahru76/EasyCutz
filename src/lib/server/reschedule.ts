import "server-only";

import { z } from "zod";
import { rankRescheduleProposals, type RescheduleCandidate } from "@/lib/reschedule";
import { generateSlots, type BusyInterval } from "@/lib/slots";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { addDays, localDateString, localDayBounds, zonedParts } from "@/lib/time";
import type { Json, RescheduleReason } from "@/lib/types/database";
import { BLOCKING_APPOINTMENT_STATUSES, mapShift } from "@/lib/types/domain";
import { fromDbError } from "./errors";
import { getSettings } from "./data";

/** How many days after the original date the proposal search looks. */
const SEARCH_DAYS = 7;
/** Minimum notice for "delay" / "early" offers. */
const URGENT_LEAD_MIN = 5;

/**
 * Builds ranked reschedule proposals for one appointment using the real slot
 * engine (shifts, breaks/time off, live bookings, other customers' holds).
 */
export async function proposeRescheduleSlots(
  appointmentId: string,
  reason: RescheduleReason,
  limit = 3,
  now = new Date(),
): Promise<RescheduleCandidate[]> {
  const db = getAdminSupabase();
  const settings = await getSettings();
  const { data: appt, error } = await db.from("appointments").select("*").eq("id", appointmentId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!appt) throw fromDbError({ message: "not_found" });
  if (appt.status !== "confirmed" && appt.status !== "checked_in") throw fromDbError({ message: "invalid_transition" });

  const tz = settings.timezone;
  const today = localDateString(now, tz);
  const originalDate = localDateString(new Date(appt.starts_at), tz);
  const origParts = zonedParts(new Date(appt.starts_at), tz);

  const firstDate = originalDate < today ? today : originalDate;
  const lastDate = reason === "early" ? firstDate : addDays(firstDate, SEARCH_DAYS);
  const horizonEnd = addDays(today, settings.bookingHorizonDays);
  const dates: string[] = [];
  for (let d = firstDate; d <= lastDate && d <= horizonEnd; d = addDays(d, 1)) dates.push(d);
  if (dates.length === 0) return [];

  const rangeStart = localDayBounds(dates[0]!, tz).start;
  const rangeEnd = localDayBounds(dates[dates.length - 1]!, tz).end;

  const [barbers, shifts, appts, timeOff, offers] = await Promise.all([
    db.from("barbers").select("id, is_on_duty").eq("is_active", true),
    db.from("barber_shifts").select("*"),
    db
      .from("appointments")
      .select("id, barber_id, starts_at, ends_at, status, hold_expires_at")
      .lt("starts_at", rangeEnd.toISOString())
      .gt("ends_at", rangeStart.toISOString()),
    db
      .from("barber_time_off")
      .select("barber_id, starts_at, ends_at")
      .lt("starts_at", rangeEnd.toISOString())
      .gt("ends_at", rangeStart.toISOString()),
    db
      .from("reschedule_offers")
      .select("appointment_id, barber_id, starts_at, ends_at")
      .eq("status", "open")
      .gt("expires_at", now.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .gt("ends_at", rangeStart.toISOString()),
  ]);
  for (const r of [barbers, shifts, appts, timeOff, offers]) if (r.error) throw fromDbError(r.error);

  const busy: BusyInterval[] = [
    ...(appts.data ?? [])
      .filter((a) => a.id !== appt.id && BLOCKING_APPOINTMENT_STATUSES.has(a.status))
      .filter((a) => a.status !== "pending_payment" || (a.hold_expires_at !== null && new Date(a.hold_expires_at) > now))
      .map((a) => ({ barberId: a.barber_id, start: new Date(a.starts_at), end: new Date(a.ends_at) })),
    ...(timeOff.data ?? []).map((t) => ({ barberId: t.barber_id, start: new Date(t.starts_at), end: new Date(t.ends_at) })),
    ...(offers.data ?? [])
      .filter((o) => o.appointment_id !== appt.id)
      .map((o) => ({ barberId: o.barber_id, start: new Date(o.starts_at), end: new Date(o.ends_at) })),
  ];

  const barberIds = reason === "early" ? [appt.barber_id] : (barbers.data ?? []).map((b) => b.id);
  const onDutyIds = new Set((barbers.data ?? []).filter((b) => b.is_on_duty).map((b) => b.id));
  const mappedShifts = (shifts.data ?? []).map(mapShift);
  const candidates: RescheduleCandidate[] = [];
  for (const date of dates) {
    const slots = generateSlots({
      date,
      durationMin: appt.duration_min,
      barberIds,
      shifts: mappedShifts,
      busy,
      now,
      timezone: tz,
      slotIntervalMin: settings.slotIntervalMin,
      // Desk-initiated, time-critical offers (running late / free early) may start soon:
      // the customer is usually already nearby. Other reasons follow the normal booking notice.
      minLeadMin: reason === "early" || reason === "delay" ? URGENT_LEAD_MIN : settings.minLeadMin,
    });
    for (const slot of slots) {
      for (const barberId of slot.availableBarberIds) {
        // Urgent same-day offers (running late / free early) only go to barbers who are in the shop now.
        if (date === today && (reason === "delay" || reason === "early") && !onDutyIds.has(barberId)) continue;
        candidates.push({ startsAt: slot.startsAt, barberId, date, localMinute: slot.localMinute });
      }
    }
  }

  return rankRescheduleProposals(
    candidates,
    {
      startsAt: appt.starts_at,
      barberId: appt.barber_id,
      date: originalDate,
      localMinute: origParts.hour * 60 + origParts.minute,
    },
    { reason, limit },
  );
}

const rescheduleResult = z.object({
  id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  barber_id: z.string(),
});
export type RescheduleResult = z.infer<typeof rescheduleResult>;

/** Customer reschedule by pass token: accept an offer, or pick a free time (when allowed). */
export async function rescheduleByToken(
  token: string,
  input: { offerId: string } | { startsAt: string; barberId: string | null },
): Promise<RescheduleResult> {
  const { data, error } = await getAdminSupabase().rpc("reschedule_by_token", {
    p_token: token,
    p_offer_id: "offerId" in input ? input.offerId : null,
    p_starts_at: "startsAt" in input ? input.startsAt : null,
    p_barber_id: "barberId" in input ? input.barberId : null,
  });
  if (error) throw fromDbError(error);
  return rescheduleResult.parse(data);
}

const createdOffers = z.array(
  z.object({ id: z.string(), starts_at: z.string(), ends_at: z.string(), barber_id: z.string(), expires_at: z.string() }),
);
export type CreatedOffer = z.infer<typeof createdOffers>[number];

export function parseCreatedOffers(data: Json): CreatedOffer[] {
  return createdOffers.parse(data);
}
