import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CheckInPanel } from "@/components/desk/CheckInPanel";
import { getSettings } from "@/lib/server/data";
import { getStaffSession } from "@/lib/server/staff";
import { tokenSchema } from "@/lib/server/validation";
import { formatClock } from "@/lib/time";

export const metadata: Metadata = { title: "Check in", robots: { index: false, follow: false } };

/**
 * Opened by scanning a customer's pass QR on the shop tablet.
 * Shows who it is, then a single tap confirms the check-in (no mutation on GET).
 */
export default async function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) notFound();

  const session = await getStaffSession();
  if (session.kind === "signed_out") redirect(`/desk/login?next=${encodeURIComponent(`/desk/checkin/${token}`)}`);
  if (session.kind === "not_staff") redirect("/desk");

  const db = session.supabase;
  const { data: priv } = await db.from("booking_private").select("*").eq("access_token", token).maybeSingle();
  if (!priv) notFound();

  const settings = await getSettings();
  let label = "";
  let detail = "";
  let checkedIn = false;

  if (priv.kind === "ticket" && priv.ticket_id) {
    const { data: t } = await db.from("queue_tickets").select("*").eq("id", priv.ticket_id).maybeSingle();
    if (!t) notFound();
    label = t.code;
    detail = `${t.service_summary} · ${t.status.replace("_", " ")}`;
    checkedIn = t.checked_in_at !== null;
  } else if (priv.appointment_id) {
    const { data: a } = await db.from("appointments").select("*").eq("id", priv.appointment_id).maybeSingle();
    if (!a) notFound();
    label = formatClock(a.starts_at, settings.timezone);
    detail = `${a.service_summary} · ${a.status.replace("_", " ")}`;
    checkedIn = a.checked_in_at !== null;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <CheckInPanel
        token={token}
        customerName={priv.customer_name}
        label={label}
        detail={detail}
        alreadyCheckedIn={checkedIn}
      />
    </main>
  );
}
