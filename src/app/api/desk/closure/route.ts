import { closeShop, loadClosureSummary } from "@/lib/server/closure";
import { AppError, errorResponse, fromDbError } from "@/lib/server/errors";
import { getStaffSession } from "@/lib/server/staff";
import { deskClosureSchema, parseOrThrow } from "@/lib/server/validation";

/**
 * EZ-001 emergency closure (staff only).
 *   GET  -> active (or just-ended) closure + every affected booking, for the desk
 *   POST { action: "close", until, reason, message } -> close now / change reopen time,
 *        then publish reschedule proposals for affected appointments
 *   POST { action: "reopen" } -> reopen now (closure kept as history)
 * Every database call runs AS the signed-in staff member, so is_staff is re-checked.
 */
async function requireStaff() {
  const session = await getStaffSession();
  if (session.kind !== "staff") throw new AppError("forbidden", 403, "Staff access only.");
  return session;
}

export async function GET(): Promise<Response> {
  try {
    const session = await requireStaff();
    return Response.json(await loadClosureSummary(session.supabase), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireStaff();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("invalid_request", 400, "Request body must be JSON.");
    }
    const input = parseOrThrow(deskClosureSchema, body);

    if (input.action === "reopen") {
      const { error } = await session.supabase.rpc("desk_reopen_shop");
      if (error) throw fromDbError(error);
      return Response.json({ reopened: true });
    }

    const result = await closeShop(session.supabase, input);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
