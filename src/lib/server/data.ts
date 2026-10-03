import "server-only";

import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { maskPhone } from "@/lib/format";
import { generateSlots, type BusyInterval } from "@/lib/slots";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { addDays, localDateString, localDayBounds } from "@/lib/time";
import type { TableRow } from "@/lib/types/database";
import {
  BLOCKING_APPOINTMENT_STATUSES,
  mapAddon,
  mapAppointment,
  mapBarber,
  mapBreak,
  mapService,
  mapSettings,
  mapShift,
  mapTicket,
  type Catalog,
  type CreateBookingResponse,
  type PassData,
  type ShopSettings,
  type TimeSlot,
} from "@/lib/types/domain";
import { AppError, fromDbError } from "./errors";
import { createCheckoutSession } from "./stripe";
import type { AvailabilityQuery, CreateBookingInput } from "./validation";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export async function getSettings(): Promise<ShopSettings> {
  const { data, error } = await getAdminSupabase().from("shop_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("not_configured", 500, "Shop settings are missing. Run supabase/seed.sql.");
  return mapSettings(data);
}

export async function getCatalog(): Promise<Catalog> {
  const db = getAdminSupabase();
  const [settings, services, addons, barbers, shifts, breaks] = await Promise.all([
    getSettings(),
    db.from("services").select("*").eq("is_active", true).order("sort_order").order("name"),
    db.from("addons").select("*").eq("is_active", true).order("sort_order").order("name"),
    db.from("barbers").select("*").eq("is_active", true).order("sort_order").order("display_name"),
    db.from("barber_shifts").select("*"),
    db.from("barber_breaks").select("*").order("weekday").order("start_time"),
  ]);
  for (const r of [services, addons, barbers, shifts, breaks]) if (r.error) throw fromDbError(r.error);

  return {
    settings,
    services: (services.data ?? []).map(mapService),
    addons: (addons.data ?? []).map(mapAddon),
    barbers: (barbers.data ?? []).map(mapBarber),
    shifts: (shifts.data ?? []).map(mapShift),
    breaks: (breaks.data ?? []).map(mapBreak),
    paymentsEnabled: serverEnv.paymentsEnabled,
  };
}

// ---------------------------------------------------------------------------
// Availability (Mode A)
// ---------------------------------------------------------------------------
export interface AvailabilityResult {
  date: string;
  durationMin: number;
  slots: TimeSlot[];
}

export async function getAvailability(query: AvailabilityQuery, now = new Date()): Promise<AvailabilityResult> {
  const db = getAdminSupabase();
  const settings = await getSettings();
  const today = localDateString(now, settings.timezone);
  if (query.date < today || query.date > addDays(today, settings.bookingHorizonDays)) {
    return { date: query.date, durationMin: 0, slots: [] };
  }

  const expire = await db.rpc("expire_stale_holds");
  if (expire.error) throw fromDbError(expire.error);

  const [services, addons, barbers] = await Promise.all([
    db.from("services").select("id, duration_min").in("id", query.services).eq("is_active", true),
    query.addons.length
      ? db.from("addons").select("id, duration_min").in("id", query.addons).eq("is_active", true)
      : Promise.resolve({ data: [] as Array<{ id: string; duration_min: number }>, error: null }),
    db.from("barbers").select("id").eq("is_active", true),
  ]);
  for (const r of [services, addons, barbers]) if (r.error) throw fromDbError(r.error);
  if ((services.data ?? []).length !== query.services.length) throw fromDbError({ message: "unknown_service" });
  if ((addons.data ?? []).length !== query.addons.length) throw fromDbError({ message: "unknown_addon" });

  const durationMin =
    (services.data ?? []).reduce((s, r) => s + r.duration_min, 0) +
    (addons.data ?? []).reduce((s, r) => s + r.duration_min, 0);

  const barberIds = query.barber === "any" ? (barbers.data ?? []).map((b) => b.id) : [query.barber];
  if (query.barber !== "any" && !(barbers.data ?? []).some((b) => b.id === query.barber)) {
    throw fromDbError({ message: "barber_unavailable" });
  }

  const { start, end } = localDayBounds(query.date, settings.timezone);
  const [shifts, appts, timeOff, offers, closures, breaks] = await Promise.all([
    db.from("barber_shifts").select("*").in("barber_id", barberIds),
    db
      .from("appointments")
      .select("id, barber_id, starts_at, ends_at, status")
      .in("barber_id", barberIds)
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString()),
    db
      .from("barber_time_off")
      .select("barber_id, starts_at, ends_at")
      .in("barber_id", barberIds)
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString()),
    db
      .from("reschedule_offers")
      .select("appointment_id, barber_id, starts_at, ends_at")
      .eq("status", "open")
      .gt("expires_at", now.toISOString())
      .in("barber_id", barberIds)
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString()),
    loadClosureWindows(start, end),
    db.from("barber_breaks").select("*").in("barber_id", barberIds),
  ]);
  for (const r of [shifts, appts, timeOff, offers, breaks]) if (r.error) throw fromDbError(r.error);

  const busy: BusyInterval[] = [
    ...(appts.data ?? [])
      .filter((a) => BLOCKING_APPOINTMENT_STATUSES.has(a.status) && a.id !== query.ignore)
      .map((a) => ({ barberId: a.barber_id, start: new Date(a.starts_at), end: new Date(a.ends_at), booking: true })),
    ...(timeOff.data ?? []).map((t) => ({ barberId: t.barber_id, start: new Date(t.starts_at), end: new Date(t.ends_at) })),
    // EZ-002: times held for other customers' reschedule offers are not bookable
    ...(offers.data ?? [])
      .filter((o) => o.appointment_id !== query.ignore)
      .map((o) => ({ barberId: o.barber_id, start: new Date(o.starts_at), end: new Date(o.ends_at), booking: true })),
    // EZ-001: emergency closure blocks every chair
    ...closureBusy(closures, barberIds),
  ];

  const slots = generateSlots({
    date: query.date,
    durationMin,
    barberIds,
    shifts: (shifts.data ?? []).map(mapShift),
    busy,
    now,
    timezone: settings.timezone,
    slotIntervalMin: settings.slotIntervalMin,
    minLeadMin: settings.minLeadMin,
    breaks: (breaks.data ?? []).map(mapBreak),
    bufferMin: settings.bufferAfterServiceMin,
  });

  return { date: query.date, durationMin, slots };
}

// ---------------------------------------------------------------------------
// Booking creation (both modes)
// ---------------------------------------------------------------------------
const rpcBookingResult = z.object({
  kind: z.enum(["appointment", "ticket"]),
  id: z.string(),
  access_token: z.string(),
  code: z.string().optional(),
  price_cents: z.number(),
  duration_min: z.number(),
  amount_due_now_cents: z.number(),
  service_summary: z.string(),
});

export async function createBooking(input: CreateBookingInput, origin: string): Promise<CreateBookingResponse> {
  if (input.paymentOption !== "cash_on_site" && !serverEnv.paymentsEnabled) {
    throw new AppError("payments_unavailable", 503, "Online payment isn't available right now — please choose Pay at the shop.");
  }
  const db = getAdminSupabase();
  const settings = await getSettings();

  const rpc =
    input.mode === "walk_in"
      ? await db.rpc("issue_queue_ticket", {
          p_preferred_barber_id: input.barberId,
          p_service_ids: input.serviceIds,
          p_addon_ids: input.addonIds,
          p_customer_name: input.customer.name,
          p_phone: input.customer.phone,
          p_email: input.customer.email,
          p_payment_option: input.paymentOption,
          p_notes: input.customer.notes,
        })
      : await db.rpc("book_appointment", {
          p_barber_id: input.barberId,
          p_starts_at: input.startsAt,
          p_service_ids: input.serviceIds,
          p_addon_ids: input.addonIds,
          p_customer_name: input.customer.name,
          p_phone: input.customer.phone,
          p_email: input.customer.email,
          p_payment_option: input.paymentOption,
          p_notes: input.customer.notes,
        });
  if (rpc.error) throw fromDbError(rpc.error);

  const booking = rpcBookingResult.parse(rpc.data);
  const passUrl = `${origin}/pass/${booking.access_token}`;
  let checkoutUrl: string | null = null;

  if (booking.amount_due_now_cents > 0) {
    try {
      checkoutUrl = await openCheckout({
        kind: booking.kind,
        bookingId: booking.id,
        accessToken: booking.access_token,
        amountCents: booking.amount_due_now_cents,
        priceCents: booking.price_cents,
        summary: booking.service_summary,
        email: input.customer.email,
        origin,
        settings,
        isDeposit: input.paymentOption === "deposit",
      });
    } catch (err) {
      // Never leave a chair held (or a ticket in line) for a payment that never started.
      await db.rpc("cancel_booking", { p_token: booking.access_token });
      throw err;
    }
  }

  return {
    kind: booking.kind,
    bookingId: booking.id,
    passUrl,
    checkoutUrl,
    code: booking.code ?? null,
  };
}

async function openCheckout(args: {
  kind: "appointment" | "ticket";
  bookingId: string;
  accessToken: string;
  amountCents: number;
  priceCents: number;
  summary: string;
  email: string | null;
  origin: string;
  settings: ShopSettings;
  isDeposit: boolean;
}): Promise<string> {
  const session = await createCheckoutSession({
    kind: args.kind,
    bookingId: args.bookingId,
    accessToken: args.accessToken,
    amountCents: args.amountCents,
    currency: args.settings.currency,
    title: `${args.settings.shopName} — ${args.isDeposit ? "Booking deposit" : "Prepaid visit"}`,
    description: args.summary,
    customerEmail: args.email,
    origin: args.origin,
    holdMinutes: args.settings.holdMinutes,
  });
  if (!session.url) throw new AppError("payments_unavailable", 502, "Couldn't start the payment page. Please try again.");

  const insert = await getAdminSupabase()
    .from("payments")
    .insert({
      kind: args.kind,
      appointment_id: args.kind === "appointment" ? args.bookingId : null,
      ticket_id: args.kind === "ticket" ? args.bookingId : null,
      stripe_checkout_session_id: session.id,
      amount_cents: args.amountCents,
      currency: args.settings.currency,
      status: "pending",
    });
  if (insert.error) throw fromDbError(insert.error);
  return session.url;
}

/** Re-opens payment for an unpaid booking (e.g. the customer closed the Stripe tab). */
export async function resumePayment(token: string, origin: string): Promise<string> {
  const db = getAdminSupabase();
  const settings = await getSettings();
  const { data: priv, error } = await db.from("booking_private").select("*").eq("access_token", token).maybeSingle();
  if (error) throw fromDbError(error);
  if (!priv) throw fromDbError({ message: "not_found" });

  if (priv.kind === "appointment" && priv.appointment_id) {
    const { data: a, error: e } = await db.from("appointments").select("*").eq("id", priv.appointment_id).single();
    if (e) throw fromDbError(e);
    const holdAlive = a.hold_expires_at !== null && new Date(a.hold_expires_at).getTime() > Date.now();
    if (a.status !== "pending_payment" || !holdAlive || a.amount_due_now_cents <= 0) {
      throw fromDbError({ message: "invalid_transition" });
    }
    return openCheckout({
      kind: "appointment", bookingId: a.id, accessToken: token, amountCents: a.amount_due_now_cents,
      priceCents: a.price_cents, summary: a.service_summary, email: priv.email, origin, settings,
      isDeposit: a.payment_option === "deposit",
    });
  }

  if (priv.kind === "ticket" && priv.ticket_id) {
    const { data: t, error: e } = await db.from("queue_tickets").select("*").eq("id", priv.ticket_id).single();
    if (e) throw fromDbError(e);
    if (!["waiting", "called"].includes(t.status) || t.payment_status === "paid" || t.amount_due_now_cents <= 0) {
      throw fromDbError({ message: "invalid_transition" });
    }
    return openCheckout({
      kind: "ticket", bookingId: t.id, accessToken: token, amountCents: t.amount_due_now_cents,
      priceCents: t.price_cents, summary: t.service_summary, email: priv.email, origin, settings,
      isDeposit: t.payment_option === "deposit",
    });
  }

  throw fromDbError({ message: "not_found" });
}

export async function cancelByToken(token: string): Promise<void> {
  const { error } = await getAdminSupabase().rpc("cancel_booking", { p_token: token });
  if (error) throw fromDbError(error);
}

// ---------------------------------------------------------------------------
// Digital pass
// ---------------------------------------------------------------------------
export async function getPass(token: string): Promise<PassData | null> {
  const db = getAdminSupabase();
  const { data: priv, error } = await db.from("booking_private").select("*").eq("access_token", token).maybeSingle();
  if (error) throw fromDbError(error);
  if (!priv) return null;

  let booking: PassData["booking"];
  let barberId: string | null;
  let preferredId: string | null = null;
  let reschedule: PassData["reschedule"] = null;
  let closureKey: { column: "ticket_id" | "appointment_id"; id: string };

  if (priv.kind === "ticket" && priv.ticket_id) {
    const { data, error: e } = await db.from("queue_tickets").select("*").eq("id", priv.ticket_id).maybeSingle();
    if (e) throw fromDbError(e);
    if (!data) return null;
    booking = mapTicket(data);
    closureKey = { column: "ticket_id", id: data.id };
    barberId = data.barber_id;
    preferredId = data.preferred_barber_id;
  } else if (priv.kind === "appointment" && priv.appointment_id) {
    const { data, error: e } = await db.from("appointments").select("*").eq("id", priv.appointment_id).maybeSingle();
    if (e) throw fromDbError(e);
    if (!data) return null;
    booking = mapAppointment(data);
    closureKey = { column: "appointment_id", id: data.id };
    barberId = data.barber_id;
    reschedule = await loadPassReschedule(data);
  } else {
    return null;
  }

  const closure = await loadPassClosure(closureKey.column, closureKey.id);
  const ids = [barberId, preferredId].filter((v): v is string => Boolean(v));
  const { data: barbers, error: be } = ids.length
    ? await db.from("barbers").select("*").in("id", ids)
    : { data: [], error: null };
  if (be) throw fromDbError(be);
  const byId = new Map((barbers ?? []).map((b) => [b.id, mapBarber(b)]));

  return {
    token,
    booking,
    customerName: priv.customer_name,
    phoneMasked: maskPhone(priv.phone),
    barber: barberId ? (byId.get(barberId) ?? null) : null,
    preferredBarber: preferredId ? (byId.get(preferredId) ?? null) : null,
    reschedule,
    closure,
  };
}

/** EZ-001: the most recent emergency closure that affected this booking. */
async function loadPassClosure(column: "ticket_id" | "appointment_id", id: string): Promise<PassData["closure"]> {
  const db = getAdminSupabase();
  const { data: impact, error } = await db
    .from("closure_impacts")
    .select("closure_id, action")
    .eq(column, id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!impact) return null;
  const { data: closure, error: ce } = await db
    .from("shop_closures")
    .select("starts_at, ends_at, public_message")
    .eq("id", impact.closure_id)
    .maybeSingle();
  if (ce) throw fromDbError(ce);
  if (!closure) return null;
  return { startsAt: closure.starts_at, endsAt: closure.ends_at, message: closure.public_message, action: impact.action };
}

/**
 * EZ-001: emergency closure windows overlapping [from, to). Every chair is
 * blocked during these, so callers add them as busy time for each barber.
 */
export async function loadClosureWindows(from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>> {
  const { data, error } = await getAdminSupabase()
    .from("shop_closures")
    .select("starts_at, ends_at")
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  if (error) throw fromDbError(error);
  return (data ?? []).map((c) => ({ start: new Date(c.starts_at), end: new Date(c.ends_at) }));
}

/** Expands shop-wide closure windows into per-chair busy intervals. */
export function closureBusy(windows: Array<{ start: Date; end: Date }>, barberIds: string[]): BusyInterval[] {
  return windows.flatMap((w) => barberIds.map((barberId) => ({ barberId, start: w.start, end: w.end })));
}

/** EZ-002: open offers, whether the customer may pick freely, and where the booking moved from. */
async function loadPassReschedule(appt: TableRow<"appointments">): Promise<PassData["reschedule"]> {
  const db = getAdminSupabase();
  const settings = await getSettings();
  const [offers, events] = await Promise.all([
    db
      .from("reschedule_offers")
      .select("id, barber_id, starts_at, ends_at, expires_at")
      .eq("appointment_id", appt.id)
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString())
      .order("starts_at"),
    db
      .from("booking_events")
      .select("data, created_at")
      .eq("appointment_id", appt.id)
      .eq("kind", "rescheduled")
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  if (offers.error) throw fromDbError(offers.error);
  if (events.error) throw fromDbError(events.error);

  const live = appt.status === "confirmed" || appt.status === "checked_in";
  const requested = appt.reschedule_requested_at !== null;
  const beyondCutoff = new Date(appt.starts_at).getTime() > Date.now() + settings.rescheduleCutoffMin * 60_000;
  const firstMove = events.data?.[0]?.data as { from_starts_at?: unknown } | undefined;

  return {
    allowed: live && (requested || beyondCutoff),
    requested,
    cutoffMin: settings.rescheduleCutoffMin,
    offers: live
      ? (offers.data ?? []).map((o) => ({
          id: o.id,
          barberId: o.barber_id,
          startsAt: o.starts_at,
          endsAt: o.ends_at,
          expiresAt: o.expires_at,
        }))
      : [],
    serviceIds: appt.service_ids,
    addonIds: appt.addon_ids,
    movedFrom: typeof firstMove?.from_starts_at === "string" ? firstMove.from_starts_at : null,
  };
}

// ---------------------------------------------------------------------------
// Stripe webhook settlement
// ---------------------------------------------------------------------------
export async function settleCheckout(sessionId: string, paid: boolean, paymentIntentId: string | null): Promise<string> {
  const { data, error } = await getAdminSupabase().rpc("apply_checkout_result", {
    p_session_id: sessionId,
    p_paid: paid,
    p_payment_intent_id: paymentIntentId,
  });
  if (error) throw fromDbError(error);
  const outcome = z.object({ outcome: z.string() }).parse(data).outcome;
  if (outcome === "needs_refund") {
    console.warn(`[easycutz] checkout ${sessionId} was paid after its slot was taken — flagged needs_refund`);
  }
  return outcome;
}

/** Public origin for links (pass URL, Stripe redirects, QR codes). */
export function resolveOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
