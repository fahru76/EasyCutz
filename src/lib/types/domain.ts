/**
 * Application-level (camelCase) domain model + row mappers.
 * Database rows (snake_case) never leak past the data layer / realtime hook.
 */
import type { DbEnum, TableRow } from "./database";

export type ServiceCategory = DbEnum<"service_category">;
export type TicketStatus = DbEnum<"ticket_status">;
export type AppointmentStatus = DbEnum<"appointment_status">;
export type PaymentOption = DbEnum<"payment_option">;
export type PaymentStatus = DbEnum<"payment_status">;
export type BookingKind = DbEnum<"booking_kind">;

export type BookingMode = "scheduled" | "walk_in";
/** A concrete barber id, or "any" for the First Available Barber option. */
export type BarberChoice = string | "any";

export const SERVICE_CATEGORIES: ReadonlyArray<{ id: ServiceCategory; label: string }> = [
  { id: "haircut", label: "Haircuts" },
  { id: "beard_shave", label: "Beard & Shave" },
  { id: "combo", label: "Combos" },
  { id: "scalp", label: "Scalp Treatments" },
];

export interface ShopSettings {
  shopName: string;
  timezone: string;
  currency: string;
  slotIntervalMin: number;
  bookingHorizonDays: number;
  minLeadMin: number;
  holdMinutes: number;
  depositPercent: number;
  minDepositCents: number;
  notifyLeadMin: number;
  /** EZ-011: prompt the desk to notify a booked customer once their delay reaches this. */
  delayNotifyMin: number;
  /** EZ-011: free gap before a booking that makes the desk suggest "come in early". */
  earlyOfferMin: number;
  /** EZ-002: customers can self-reschedule until this many minutes before the booking. */
  rescheduleCutoffMin: number;
  /** EZ-002: how long proposed times are held for the customer. */
  offerHoldHours: number;
  shopPhone: string | null;
  shopAddress: string | null;
}

export interface Service {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ServiceCategory;
  durationMin: number;
  priceCents: number;
  isPopular: boolean;
  sortOrder: number;
}

export interface Addon {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  sortOrder: number;
}

export interface Barber {
  id: string;
  slug: string;
  displayName: string;
  specialty: string;
  bio: string;
  avatarUrl: string | null;
  rating: number;
  reviewCount: number;
  ticketPrefix: string;
  isOnDuty: boolean;
  sortOrder: number;
}

export interface Shift {
  barberId: string;
  /** 0 = Sunday … 6 = Saturday (shop-local) */
  weekday: number;
  /** minutes from local midnight */
  startMin: number;
  endMin: number;
}

export interface TimeOff {
  barberId: string;
  startsAt: string;
  endsAt: string;
}

export interface Catalog {
  settings: ShopSettings;
  services: Service[];
  addons: Addon[];
  barbers: Barber[];
  shifts: Shift[];
  paymentsEnabled: boolean;
}

export interface LiveTicket {
  id: string;
  kind: "ticket";
  shopDay: string;
  ticketNumber: number;
  code: string;
  preferredBarberId: string | null;
  barberId: string | null;
  status: TicketStatus;
  durationMin: number;
  priceCents: number;
  serviceSummary: string;
  displayName: string;
  paymentOption: PaymentOption;
  paymentStatus: PaymentStatus;
  checkedInAt: string | null;
  notifiedAt: string | null;
  /** Expected finish while in the chair (adjustable from the desk). */
  expectedEndAt: string | null;
  calledAt: string | null;
  seatedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface LiveAppointment {
  id: string;
  kind: "appointment";
  barberId: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  priceCents: number;
  serviceSummary: string;
  displayName: string;
  status: AppointmentStatus;
  paymentOption: PaymentOption;
  paymentStatus: PaymentStatus;
  amountDueNowCents: number;
  holdExpiresAt: string | null;
  expectedEndAt: string | null;
  delayNotifiedAt: string | null;
  delayNotifiedMin: number | null;
  rescheduleRequestedAt: string | null;
  serviceIds: string[];
  addonIds: string[];
  checkedInAt: string | null;
  calledAt: string | null;
  seatedAt: string | null;
  completedAt: string | null;
}

export type LiveBooking = LiveTicket | LiveAppointment;

/** Statuses during which an appointment occupies its chair window. */
export const BLOCKING_APPOINTMENT_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "pending_payment",
  "confirmed",
  "checked_in",
  "called",
  "in_chair",
]);

export const ACTIVE_TICKET_STATUSES: ReadonlySet<TicketStatus> = new Set(["waiting", "called", "in_chair"]);

export interface BookingContact {
  kind: BookingKind;
  bookingId: string;
  customerName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  accessToken: string;
}

export interface CartLine {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  type: "service" | "addon";
}

export interface CartTotals {
  lines: CartLine[];
  durationMin: number;
  priceCents: number;
}

export interface TimeSlot {
  /** ISO-8601 UTC instant */
  startsAt: string;
  /** minutes from shop-local midnight */
  localMinute: number;
  availableBarberIds: string[];
}

export interface CustomerDetails {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

/** Response of POST /api/bookings */
export interface CreateBookingResponse {
  kind: BookingKind;
  bookingId: string;
  passUrl: string;
  checkoutUrl: string | null;
  code: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

/** A time the shop has proposed and is holding for a customer (EZ-002). */
export interface RescheduleOffer {
  id: string;
  barberId: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
}

export interface PassReschedule {
  /** Customer may pick any free time now (beyond cutoff, or the shop asked them to). */
  allowed: boolean;
  /** The shop asked for a reschedule (delay, closure…). */
  requested: boolean;
  cutoffMin: number;
  offers: RescheduleOffer[];
  serviceIds: string[];
  addonIds: string[];
  /** Original start if the booking was moved. */
  movedFrom: string | null;
}

/** Everything the digital pass page needs about one booking. */
export interface PassData {
  token: string;
  booking: LiveBooking;
  customerName: string;
  phoneMasked: string;
  barber: Barber | null;
  preferredBarber: Barber | null;
  /** Present for appointments only. */
  reschedule: PassReschedule | null;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------
export function parseTimeToMinutes(value: string): number {
  const [h = "0", m = "0"] = value.split(":");
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

export function mapSettings(row: TableRow<"shop_settings">): ShopSettings {
  return {
    shopName: row.shop_name,
    timezone: row.timezone,
    currency: row.currency,
    slotIntervalMin: row.slot_interval_min,
    bookingHorizonDays: row.booking_horizon_days,
    minLeadMin: row.min_lead_min,
    holdMinutes: row.hold_minutes,
    depositPercent: row.deposit_percent,
    minDepositCents: row.min_deposit_cents,
    notifyLeadMin: row.notify_lead_min,
    delayNotifyMin: row.delay_notify_min,
    earlyOfferMin: row.early_offer_min,
    rescheduleCutoffMin: row.reschedule_cutoff_min,
    offerHoldHours: row.offer_hold_hours,
    shopPhone: row.shop_phone,
    shopAddress: row.shop_address,
  };
}

export function mapService(row: TableRow<"services">): Service {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    isPopular: row.is_popular,
    sortOrder: row.sort_order,
  };
}

export function mapAddon(row: TableRow<"addons">): Addon {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    sortOrder: row.sort_order,
  };
}

export function mapBarber(row: TableRow<"barbers">): Barber {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    specialty: row.specialty,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    rating: Number(row.rating),
    reviewCount: row.review_count,
    ticketPrefix: row.ticket_prefix,
    isOnDuty: row.is_on_duty,
    sortOrder: row.sort_order,
  };
}

export function mapShift(row: TableRow<"barber_shifts">): Shift {
  return {
    barberId: row.barber_id,
    weekday: row.weekday,
    startMin: parseTimeToMinutes(row.start_time),
    endMin: parseTimeToMinutes(row.end_time),
  };
}

export function mapTicket(row: TableRow<"queue_tickets">): LiveTicket {
  return {
    id: row.id,
    kind: "ticket",
    shopDay: row.shop_day,
    ticketNumber: row.ticket_number,
    code: row.code,
    preferredBarberId: row.preferred_barber_id,
    barberId: row.barber_id,
    status: row.status,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    serviceSummary: row.service_summary,
    displayName: row.display_name,
    paymentOption: row.payment_option,
    paymentStatus: row.payment_status,
    checkedInAt: row.checked_in_at,
    notifiedAt: row.notified_at,
    expectedEndAt: row.expected_end_at,
    calledAt: row.called_at,
    seatedAt: row.seated_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function mapAppointment(row: TableRow<"appointments">): LiveAppointment {
  return {
    id: row.id,
    kind: "appointment",
    barberId: row.barber_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    serviceSummary: row.service_summary,
    displayName: row.display_name,
    status: row.status,
    paymentOption: row.payment_option,
    paymentStatus: row.payment_status,
    amountDueNowCents: row.amount_due_now_cents,
    holdExpiresAt: row.hold_expires_at,
    expectedEndAt: row.expected_end_at,
    delayNotifiedAt: row.delay_notified_at,
    delayNotifiedMin: row.delay_notified_min,
    rescheduleRequestedAt: row.reschedule_requested_at,
    serviceIds: row.service_ids,
    addonIds: row.addon_ids,
    checkedInAt: row.checked_in_at,
    calledAt: row.called_at,
    seatedAt: row.seated_at,
    completedAt: row.completed_at,
  };
}

export function mapContact(row: TableRow<"booking_private">): BookingContact {
  const bookingId = row.kind === "ticket" ? row.ticket_id : row.appointment_id;
  if (!bookingId) {
    throw new Error(`booking_private ${row.id} has no linked booking`);
  }
  return {
    kind: row.kind,
    bookingId,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    accessToken: row.access_token,
  };
}
