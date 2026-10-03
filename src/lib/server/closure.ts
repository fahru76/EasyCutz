import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/types/database";
import type { ClosureImpactAction, ClosureReason, RescheduleOffer } from "@/lib/types/domain";
import { fromDbError } from "./errors";
import { parseCreatedOffers, proposeRescheduleSlots } from "./reschedule";

type Db = SupabaseClient<Database>;

/** One affected booking as the desk sees it (EZ-001). Contact details are staff-only. */
export interface ClosureImpactView {
  id: string;
  action: ClosureImpactAction;
  kind: "ticket" | "appointment";
  bookingId: string;
  code: string | null;
  customerName: string;
  phone: string;
  passToken: string;
  status: string;
  startsAt: string | null;
  barberId: string | null;
  hadPayment: boolean;
  needsRefund: boolean;
  notifiedAt: string | null;
  /** Appointment still sits inside the closure window (not moved yet). */
  stillInWindow: boolean;
  offers: RescheduleOffer[];
}

export interface ClosureView {
  id: string;
  startsAt: string;
  endsAt: string;
  plannedEndsAt: string;
  reason: ClosureReason;
  message: string;
  reopenedAt: string | null;
  active: boolean;
}

export interface ClosureSummary {
  closure: ClosureView | null;
  impacts: ClosureImpactView[];
}

/** How long after it ends a closure stays on the desk for follow-up. */
const FOLLOW_UP_HOURS = 24;

function bookingFilter(ticketIds: string[], apptIds: string[]): string {
  return [
    ticketIds.length ? `ticket_id.in.(${ticketIds.join(",")})` : null,
    apptIds.length ? `appointment_id.in.(${apptIds.join(",")})` : null,
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * The active closure, or the most recent one that ended within the follow-up
 * window, with every affected booking. Runs as the signed-in staff member, so
 * RLS limits it to staff.
 */
export async function loadClosureSummary(db: Db, now = new Date()): Promise<ClosureSummary> {
  const since = new Date(now.getTime() - FOLLOW_UP_HOURS * 3_600_000).toISOString();
  const { data: row, error } = await db
    .from("shop_closures")
    .select("*")
    .gt("ends_at", since)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!row) return { closure: null, impacts: [] };

  const closure: ClosureView = {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    plannedEndsAt: row.planned_ends_at,
    reason: row.reason,
    message: row.public_message,
    reopenedAt: row.reopened_at,
    active: new Date(row.starts_at) <= now && new Date(row.ends_at) > now,
  };

  const { data: impacts, error: ie } = await db
    .from("closure_impacts")
    .select("*")
    .eq("closure_id", row.id)
    .order("created_at");
  if (ie) throw fromDbError(ie);
  const list = impacts ?? [];
  if (list.length === 0) return { closure, impacts: [] };
  const ticketIds = list.flatMap((i) => (i.ticket_id ? [i.ticket_id] : []));
  const apptIds = list.flatMap((i) => (i.appointment_id ? [i.appointment_id] : []));
  const filter = bookingFilter(ticketIds, apptIds);

  const [tickets, appts, contacts, payments, offers] = await Promise.all([
    db.from("queue_tickets").select("id, code, status").in("id", ticketIds.length ? ticketIds : [crypto.randomUUID()]),
    db
      .from("appointments")
      .select("id, status, starts_at, ends_at, barber_id")
      .in("id", apptIds.length ? apptIds : [crypto.randomUUID()]),
    db.from("booking_private").select("ticket_id, appointment_id, customer_name, phone, access_token").or(filter),
    db.from("payments").select("ticket_id, appointment_id, needs_refund").or(filter),
    db
      .from("reschedule_offers")
      .select("id, appointment_id, barber_id, starts_at, ends_at, expires_at")
      .in("appointment_id", apptIds.length ? apptIds : [crypto.randomUUID()])
      .eq("status", "open")
      .gt("expires_at", now.toISOString())
      .order("starts_at"),
  ]);
  for (const r of [tickets, appts, contacts, payments, offers]) if (r.error) throw fromDbError(r.error);

  const ticketById = new Map((tickets.data ?? []).map((t) => [t.id, t]));
  const apptById = new Map((appts.data ?? []).map((a) => [a.id, a]));
  const contactBy = new Map((contacts.data ?? []).map((c) => [c.ticket_id ?? c.appointment_id ?? "", c]));
  const refundBy = new Set(
    (payments.data ?? []).filter((p) => p.needs_refund).map((p) => p.ticket_id ?? p.appointment_id ?? ""),
  );
  const windowStart = new Date(closure.startsAt).getTime();
  const windowEnd = new Date(closure.endsAt).getTime();

  const views: ClosureImpactView[] = [];
  for (const i of list) {
    const bookingId = i.ticket_id ?? i.appointment_id;
    if (!bookingId) continue;
    const contact = contactBy.get(bookingId);
    if (!contact) continue;
    const ticket = i.ticket_id ? ticketById.get(i.ticket_id) : undefined;
    const appt = i.appointment_id ? apptById.get(i.appointment_id) : undefined;
    views.push({
      id: i.id,
      action: i.action,
      kind: i.ticket_id ? "ticket" : "appointment",
      bookingId,
      code: ticket?.code ?? null,
      customerName: contact.customer_name,
      phone: contact.phone,
      passToken: contact.access_token,
      status: ticket?.status ?? appt?.status ?? "unknown",
      startsAt: appt?.starts_at ?? null,
      barberId: appt?.barber_id ?? null,
      hadPayment: i.had_payment,
      needsRefund: refundBy.has(bookingId),
      notifiedAt: i.notified_at,
      stillInWindow: appt
        ? new Date(appt.starts_at).getTime() < windowEnd && new Date(appt.ends_at).getTime() > windowStart
        : false,
      offers: (offers.data ?? [])
        .filter((o) => o.appointment_id === bookingId)
        .map((o) => ({ id: o.id, barberId: o.barber_id, startsAt: o.starts_at, endsAt: o.ends_at, expiresAt: o.expires_at })),
    });
  }
  return { closure, impacts: views };
}

const closeResult = z.object({
  closure_id: z.string(),
  ends_at: z.string(),
  tickets_cancelled: z.number(),
  holds_released: z.number(),
  offers_released: z.number(),
  appointment_ids: z.array(z.string()),
});

export interface CloseShopResult {
  closureId: string;
  endsAt: string;
  ticketsCancelled: number;
  holdsReleased: number;
  appointments: number;
  appointmentsWithOffers: number;
}

/**
 * Closes the shop as the signed-in staff member, then prepares reschedule
 * proposals (soft-held offers, EZ-002) for every affected appointment so the
 * desk can notify everyone straight away.
 */
export async function closeShop(
  db: Db,
  input: { until: string; reason: ClosureReason; message: string },
): Promise<CloseShopResult> {
  const { data, error } = await db.rpc("desk_close_shop", {
    p_until: input.until,
    p_reason: input.reason,
    p_message: input.message,
  });
  if (error) throw fromDbError(error);
  const result = closeResult.parse(data);

  let withOffers = 0;
  for (const appointmentId of result.appointment_ids) {
    try {
      const proposals = await proposeRescheduleSlots(appointmentId, "closure", 3);
      if (proposals.length === 0) continue;
      const created = await db.rpc("create_reschedule_offers", {
        p_appointment_id: appointmentId,
        p_reason: "closure",
        p_offers: proposals.map((p) => ({ starts_at: p.startsAt, barber_id: p.barberId })),
      });
      if (created.error) throw fromDbError(created.error);
      if (parseCreatedOffers(created.data ?? []).length > 0) withOffers += 1;
    } catch (err) {
      // One booking failing must not block the rest; the desk can retry that row.
      console.error("[easycutz] closure proposals failed for", appointmentId, err);
    }
  }

  return {
    closureId: result.closure_id,
    endsAt: result.ends_at,
    ticketsCancelled: result.tickets_cancelled,
    holdsReleased: result.holds_released,
    appointments: result.appointment_ids.length,
    appointmentsWithOffers: withOffers,
  };
}
