import { getAvailability } from "@/lib/server/data";
import { errorResponse } from "@/lib/server/errors";
import { availabilityQuerySchema, parseOrThrow } from "@/lib/server/validation";

/**
 * GET /api/availability?date=YYYY-MM-DD&barber=any|<uuid>&services=<id,id>&addons=<id,id>
 * Returns slots where the full cumulative duration of the cart fits.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = parseOrThrow(availabilityQuerySchema, params);
    const result = await getAvailability(query);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
