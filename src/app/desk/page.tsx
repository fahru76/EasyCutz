import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeskBoard } from "@/components/desk/DeskBoard";
import { getCatalog } from "@/lib/server/data";
import { getStaffSession } from "@/lib/server/staff";

export const metadata: Metadata = { title: "Quick-Desk", robots: { index: false, follow: false } };

export default async function DeskPage() {
  const session = await getStaffSession();
  if (session.kind === "signed_out") redirect("/desk/login");
  if (session.kind === "not_staff") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="text-xl font-bold">No desk access</h1>
        <p className="mt-2 text-zinc-400">
          {session.email ?? "This account"} is signed in but isn&apos;t registered as staff. Ask the owner to add you to
          the <code className="font-mono text-amber-400">staff</code> table.
        </p>
      </main>
    );
  }

  const catalog = await getCatalog();
  const h = await headers();
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = configured ? configured.replace(/\/+$/, "") : `${proto}://${host}`;

  return (
    <DeskBoard
      settings={catalog.settings}
      initialBarbers={catalog.barbers}
      shifts={catalog.shifts}
      staffName={session.displayName}
      isOwner={session.role === "owner"}
      origin={origin}
    />
  );
}
