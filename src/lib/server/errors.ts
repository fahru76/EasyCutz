import "server-only";

import type { ApiError } from "@/lib/types/domain";

/** Maps the stable error messages raised by our SQL functions to HTTP + copy. */
const KNOWN_ERRORS: Record<string, { status: number; message: string }> = {
  empty_cart: { status: 400, message: "Pick at least one service." },
  cart_too_large: { status: 400, message: "That's a lot of services — please split it into two visits." },
  duplicate_items: { status: 400, message: "Your cart contains a duplicate item." },
  unknown_service: { status: 409, message: "One of the services is no longer offered. Please refresh the menu." },
  unknown_addon: { status: 409, message: "One of the add-ons is no longer offered. Please refresh the menu." },
  nothing_to_charge: { status: 400, message: "There's nothing to pay online for this booking." },
  shop_closed: { status: 409, message: "No barbers are on duty right now, so the live queue is closed." },
  barber_unavailable: { status: 409, message: "That barber isn't taking customers right now. Try First Available." },
  already_in_queue: { status: 409, message: "This phone number already has a live ticket today." },
  slot_in_past: { status: 409, message: "That time has just passed. Please pick a later slot." },
  beyond_horizon: { status: 400, message: "That date is too far ahead to book." },
  misaligned_slot: { status: 400, message: "Please pick one of the listed time slots." },
  slot_unavailable: { status: 409, message: "Someone just grabbed that slot. Please pick another time." },
  not_found: { status: 404, message: "We couldn't find that booking." },
  invalid_transition: { status: 409, message: "This booking can't be changed any more." },
  forbidden: { status: 403, message: "Staff access only." },
  chair_busy: { status: 409, message: "That chair already has a customer in it." },
  barber_required: { status: 400, message: "Choose a barber first." },
  reschedule_cutoff: {
    status: 409,
    message: "It's too close to your booking to change it online. Please WhatsApp the shop and we'll sort it out.",
  },
  offer_expired: { status: 409, message: "That time is no longer held for you. Please pick another one." },
  invalid_request: { status: 400, message: "Something about that request wasn't right. Please try again." },
  invalid_value: { status: 400, message: "One of the values is out of range." },
  invalid_action: { status: 400, message: "That action isn't allowed." },
};

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function fromDbError(error: { message: string } | null | undefined): AppError {
  const code = error?.message ?? "unknown";
  const known = KNOWN_ERRORS[code];
  if (known) return new AppError(code, known.status, known.message);
  console.error("[easycutz] unexpected database error:", error);
  return new AppError("server_error", 500, "Something went wrong on our side. Please try again.");
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: err.code, message: err.message } satisfies ApiError, { status: err.status });
  }
  console.error("[easycutz] unhandled error:", err);
  return Response.json(
    { error: "server_error", message: "Something went wrong on our side. Please try again." } satisfies ApiError,
    { status: 500 },
  );
}
