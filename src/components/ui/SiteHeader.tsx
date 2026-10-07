"use client";

import { Scissors } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LiveStatus } from "@/hooks/use-live-shop";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/format";
import { LanguageSwitch } from "./LanguageSwitch";
import { LiveDot } from "./primitives";

export function SiteHeader({
  shopName,
  status,
  right,
  wide = false,
  languageSwitch = true,
}: {
  wide?: boolean;
  /** EZ-010: shown on customer screens; staff screens are English-only for now. */
  languageSwitch?: boolean;
  shopName: string;
  status?: LiveStatus;
  right?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 glass-strong">
      <div className={cn("mx-auto flex h-16 items-center", wide ? "max-w-7xl" : "max-w-5xl")}>
      <div className="flex w-full items-center justify-between gap-3 px-4">
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
              title={status === "live" ? t.common.status.liveTitle : t.common.status.reconnectingTitle}
            >
              <LiveDot tone={status === "live" ? "emerald" : status === "offline" ? "rose" : "zinc"} />
              {status === "live"
                ? t.common.status.live
                : status === "offline"
                  ? t.common.status.reconnecting
                  : t.common.status.connecting}
            </span>
          )}
          {languageSwitch && <LanguageSwitch />}
          {right}
        </div>
      </div>
      </div>
    </header>
  );
}
