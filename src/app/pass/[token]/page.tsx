import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DigitalPass } from "@/components/pass/DigitalPass";
import { getCatalog, getPass } from "@/lib/server/data";
import { tokenSchema } from "@/lib/server/validation";

export const metadata: Metadata = {
  title: "Your pass",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PassPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) notFound();

  const [pass, catalog, query] = await Promise.all([getPass(token), getCatalog(), searchParams]);
  if (!pass) notFound();

  const origin = await requestOrigin();
  const payment = query.payment === "success" || query.payment === "cancelled" ? query.payment : null;

  return (
    <DigitalPass
      pass={pass}
      settings={catalog.settings}
      barbers={catalog.barbers}
      checkInUrl={`${origin}/desk/checkin/${token}`}
      passUrl={`${origin}/pass/${token}`}
      paymentParam={payment}
      paymentsEnabled={catalog.paymentsEnabled}
    />
  );
}

/** Absolute origin for QR / share links (QR scanners need absolute URLs). */
async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
