import { connection } from "next/server";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { getCatalog } from "@/lib/server/data";
import type { Catalog } from "@/lib/types/domain";

export default async function HomePage() {
  await connection(); // always render with live data at request time

  let catalog: Catalog;
  try {
    catalog = await getCatalog();
  } catch (err) {
    return <SetupProblem message={err instanceof Error ? err.message : "Unknown error"} />;
  }

  return <BookingFlow catalog={catalog} />;
}

function SetupProblem({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-500">EasyCutz</p>
      <h1 className="mt-2 text-2xl font-bold">We&apos;re getting the shop ready</h1>
      <p className="mt-2 text-zinc-400">Online booking is temporarily unavailable. Please try again shortly.</p>
      {process.env.NODE_ENV !== "production" && (
        <pre className="mt-6 whitespace-pre-wrap rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 font-mono text-xs text-rose-200">
          {message}
        </pre>
      )}
    </main>
  );
}
