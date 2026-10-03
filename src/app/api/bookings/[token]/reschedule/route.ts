import { AppError, errorResponse } from "@/lib/server/errors";
import { clientKey, enforceRateLimit } from "@/lib/server/rate-limit";
import { rescheduleByToken } from "@/lib/server/reschedule";
import { customerRescheduleSchema, parseOrThrow, tokenSchema } from "@/lib/server/validation";

/**
 * POST /api/bookings/:token/reschedule   (EZ-002)
 * Body: { offerId } to accept a time the shop is holding, or
 *       { startsAt, barberId | null } to pick a free time (allowed before the
 *       cutoff, or any time after the shop asked for a reschedule).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    enforceRateLimit(`reschedule:${clientKey(request)}`, 10, 60_000);
    const token = parseOrThrow(tokenSchema, (await params).token);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("invalid_request", 400, "Request body must be JSON.");
    }
    const input = parseOrThrow(customerRescheduleSchema, body);
    const result = await rescheduleByToken(token, input);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
