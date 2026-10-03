"use client";

import { Scissors } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LiveStatus } from "@/hooks/use-live-shop";
import { cn } from "@/lib/format";
import { LiveDot } from "./primitives";

export function SiteHeader({
  shopName,
  status,
  right,
}: {
  shopName: string;
  status?: LiveStatus;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 shadow-[0_8px_24px_-8px_rgb(245_158_11/0.7)]">
            <Scissors className="size-5" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            {shopName.replace(/z$/i, "")}
            <span className="text-amber-500">{/z$/i.test(shopName) ? shopName.slice(-1) : ""}</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {status && (
            <span
              className={cn(
                "hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider sm:inline-flex",
                status === "live" ? "text-emerald-400" : status === "offline" ? "text-rose-300" : "text-zinc-500",
              )}
              title={status === "live" ? "Realtime connected" : "Reconnecting…"}
            >
              <LiveDot tone={status === "live" ? "emerald" : status === "offline" ? "rose" : "zinc"} />
              {status === "live" ? "Live" : status === "offline" ? "Reconnecting" : "Connecting"}
            </span>
          )}
          {right}
        </div>
      </div>
    </header>
  );
}
