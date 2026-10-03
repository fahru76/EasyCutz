import { createBooking, resolveOrigin } from "@/lib/server/data";
import { AppError, errorResponse } from "@/lib/server/errors";
import { clientKey, enforceRateLimit } from "@/lib/server/rate-limit";
import { createBookingSchema, parseOrThrow } from "@/lib/server/validation";

/**
 * POST /api/bookings
 * Body: CreateBookingInput (mode "scheduled" | "walk_in").
 * Returns CreateBookingResponse — pass URL plus a Stripe Checkout URL when
 * something is due online.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    enforceRateLimit(`booking:${clientKey(request)}`, 8, 60_000);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("invalid_request", 400, "Request body must be JSON.");
    }
    const input = parseOrThrow(createBookingSchema, body);
    const result = await createBooking(input, resolveOrigin(request));
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
