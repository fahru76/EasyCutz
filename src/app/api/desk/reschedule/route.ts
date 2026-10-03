import { AppError, errorResponse, fromDbError } from "@/lib/server/errors";
import { parseCreatedOffers, proposeRescheduleSlots } from "@/lib/server/reschedule";
import { getStaffSession } from "@/lib/server/staff";
import { deskProposalSchema, parseOrThrow } from "@/lib/server/validation";

/**
 * POST /api/desk/reschedule   (EZ-002, staff only)
 * Body: { appointmentId, reason: delay|closure|barber_unavailable|early|manual, limit? }
 *
 * Computes ranked proposals with the slot engine, then publishes them as soft
 * holds through create_reschedule_offers, called AS the signed-in staff member
 * (so the database re-checks is_staff and records who did it).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await getStaffSession();
    if (session.kind !== "staff") throw new AppError("forbidden", 403, "Staff access only.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("invalid_request", 400, "Request body must be JSON.");
    }
    const input = parseOrThrow(deskProposalSchema, body);

    const proposals = await proposeRescheduleSlots(input.appointmentId, input.reason, input.limit ?? 3);
    if (proposals.length === 0) {
      return Response.json({ offers: [] });
    }

    const { data, error } = await session.supabase.rpc("create_reschedule_offers", {
      p_appointment_id: input.appointmentId,
      p_reason: input.reason,
      p_offers: proposals.map((p) => ({ starts_at: p.startsAt, barber_id: p.barberId })),
    });
    if (error) throw fromDbError(error);
    return Response.json({ offers: parseCreatedOffers(data ?? []) });
  } catch (err) {
    return errorResponse(err);
  }
}
