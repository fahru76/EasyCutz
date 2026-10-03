import { cancelByToken } from "@/lib/server/data";
import { errorResponse } from "@/lib/server/errors";
import { clientKey, enforceRateLimit } from "@/lib/server/rate-limit";
import { parseOrThrow, tokenSchema } from "@/lib/server/validation";

/** POST /api/bookings/:token/cancel — customer leaves the queue / cancels. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    enforceRateLimit(`cancel:${clientKey(request)}`, 10, 60_000);
    const token = parseOrThrow(tokenSchema, (await params).token);
    await cancelByToken(token);
    return Response.json({ cancelled: true });
  } catch (err) {
    return errorResponse(err);
  }
}
