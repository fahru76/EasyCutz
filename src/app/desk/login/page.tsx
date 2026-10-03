import type { Metadata } from "next";
import { DeskLoginForm } from "@/components/desk/DeskLoginForm";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

export default async function DeskLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const raw = typeof query.next === "string" ? query.next : "/desk";
  // Only allow same-site desk paths as the post-login destination.
  const next = raw.startsWith("/desk") && !raw.startsWith("//") ? raw : "/desk";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <DeskLoginForm next={next} />
    </main>
  );
}
