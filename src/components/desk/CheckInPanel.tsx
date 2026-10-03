"use client";

import { CircleCheck, ScanLine } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Button, Card } from "../ui/primitives";

export function CheckInPanel({
  token,
  customerName,
  label,
  detail,
  alreadyCheckedIn,
}: {
  token: string;
  customerName: string;
  label: string;
  detail: string;
  alreadyCheckedIn: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(alreadyCheckedIn ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setState("loading");
    const { error: rpcError } = await getBrowserSupabase().rpc("desk_check_in", { p_token: token });
    if (rpcError) {
      setError(
        rpcError.message === "invalid_transition"
          ? "This booking is no longer active (completed, cancelled or missed)."
          : rpcError.message === "forbidden"
            ? "Your account isn't set up as staff."
            : rpcError.message,
      );
      setState("error");
      return;
    }
    setState("done");
  }

  return (
    <Card className="w-full max-w-sm p-6 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
        {state === "done" ? <CircleCheck className="size-7 text-emerald-400" /> : <ScanLine className="size-7" />}
      </span>
      <p className="mt-4 font-mono text-4xl font-extrabold">{label}</p>
      <p className="mt-1 text-lg font-semibold">{customerName}</p>
      <p className="text-sm text-zinc-500">{detail}</p>

      {state === "done" ? (
        <p className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Checked in — they&apos;re marked as arrived on the board.
        </p>
      ) : (
        <Button size="lg" className="mt-6 w-full" loading={state === "loading"} onClick={() => void checkIn()}>
          Confirm check-in
        </Button>
      )}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      <Link href="/desk" className="mt-6 inline-block text-sm text-zinc-400 hover:text-zinc-100">
        ← Back to Quick-Desk
      </Link>
    </Card>
  );
}
