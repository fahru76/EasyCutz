import { resolveOrigin, resumePayment } from "@/lib/server/data";
import { errorResponse } from "@/lib/server/errors";
import { clientKey, enforceRateLimit } from "@/lib/server/rate-limit";
import { parseOrThrow, tokenSchema } from "@/lib/server/validation";

/** POST /api/bookings/:token/pay — opens a fresh Stripe Checkout for an unpaid booking. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    enforceRateLimit(`pay:${clientKey(request)}`, 6, 60_000);
    const token = parseOrThrow(tokenSchema, (await params).token);
    const checkoutUrl = await resumePayment(token, resolveOrigin(request));
    return Response.json({ checkoutUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
