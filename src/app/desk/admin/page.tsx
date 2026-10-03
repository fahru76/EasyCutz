import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { getStaffSession } from "@/lib/server/staff";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** Owner-only: edit services, add-ons, breaks (EZ-003), fees & rules (EZ-009). Every write is re-checked in SQL (assert_owner). */
export default async function AdminPage() {
  const session = await getStaffSession();
  if (session.kind === "signed_out") redirect("/desk/login?next=%2Fdesk%2Fadmin");
  if (session.kind === "not_staff" || session.role !== "owner") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="text-xl font-bold">Owner access only</h1>
        <p className="mt-2 text-zinc-400">Only the shop owner can change the menu, prices and fees.</p>
        <Link href="/desk" className="mt-6 text-sm text-amber-400 hover:underline">
          ← Back to Quick-Desk
        </Link>
      </main>
    );
  }

  const db = session.supabase;
  const [services, addons, settings, changes, barbers, breaks] = await Promise.all([
    db.from("services").select("*").order("category").order("sort_order"),
    db.from("addons").select("*").order("sort_order"),
    db.from("shop_settings").select("*").eq("id", 1).single(),
    db.from("catalog_changes").select("*").order("changed_at", { ascending: false }).limit(50),
    db.from("barbers").select("id, display_name, sort_order").eq("is_active", true).order("sort_order"),
    db.from("barber_breaks").select("*"),
  ]);
  const failed = services.error ?? addons.error ?? settings.error ?? changes.error ?? barbers.error ?? breaks.error;
  if (failed || !settings.data) {
    throw new Error(`Admin data could not be loaded: ${failed?.message ?? "settings missing"}`);
  }

  return (
    <AdminPanel
      services={services.data ?? []}
      addons={addons.data ?? []}
      settings={settings.data}
      changes={changes.data ?? []}
      barbers={barbers.data ?? []}
      breaks={breaks.data ?? []}
      ownerName={session.displayName}
    />
  );
}
