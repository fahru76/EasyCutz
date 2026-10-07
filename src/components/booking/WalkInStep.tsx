"use client";

import { motion } from "framer-motion";
import { Armchair, DoorClosed, Hourglass, Ticket, Users } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useI18n } from "@/i18n/provider";
import { cn, formatQueueLine, formatWait } from "@/lib/format";
import type { QueueSnapshot, WalkInEstimate } from "@/lib/queue";
import { formatClock } from "@/lib/time";
import type { Barber } from "@/lib/types/domain";
import { Badge, Card } from "../ui/primitives";

/** Fills {placeholders} in a dictionary string with React nodes. */
function richText(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((piece, i) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={i}>{key !== undefined && key in parts ? parts[key] : piece}</Fragment>;
  });
}

export function WalkInStep({
  snapshot,
  estimate,
  barbers,
  selectedBarber,
  timezone,
  closure = null,
}: {
  snapshot: QueueSnapshot;
  estimate: WalkInEstimate | null;
  barbers: Barber[];
  selectedBarber: Barber | null;
  timezone: string;
  /** EZ-001: emergency closure in force. */
  closure?: { reopens: string; message: string | null } | null;
}) {
  const { t, locale, format } = useI18n();
  const w = t.booking.walkIn;
  const byId = new Map(barbers.map((b) => [b.id, b]));

  if (closure) {
    return (
      <Card className="flex flex-col items-center border-rose-500/30 p-8 text-center">
        <DoorClosed className="size-10 text-rose-300" />
        <p className="mt-3 text-lg font-semibold text-zinc-200">{w.closedTitle}</p>
        <p className="mt-1 max-w-sm text-sm text-zinc-400">
          {format(w.closedBody, { reopens: closure.reopens })}
        </p>
      </Card>
    );
  }

  if (snapshot.onDutyIds.length === 0 || !estimate) {
    return (
      <Card className="flex flex-col items-center p-8 text-center">
        <DoorClosed className="size-10 text-zinc-600" />
        <p className="mt-3 text-lg font-semibold text-zinc-200">
          {selectedBarber && !selectedBarber.isOnDuty
            ? format(w.barberOffDutyTitle, { name: selectedBarber.displayName })
            : w.queueClosedTitle}
        </p>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">
          {selectedBarber && !selectedBarber.isOnDuty
            ? w.barberOffDutyBody
            : w.noBarbersBody}
        </p>
      </Card>
    );
  }

  const assigned = byId.get(estimate.barberId);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-zinc-800/80">
          <Stat icon={<Hourglass className="size-4" />} label={w.estWait} value={formatWait(estimate.waitMin, locale)} highlight />
          <Stat icon={<Users className="size-4" />} label={w.aheadOfYou} value={String(estimate.aheadCount)} />
          <Stat icon={<Armchair className="size-4" />} label={w.chairsOpen} value={String(snapshot.onDutyIds.length)} />
        </div>
        <div className="border-t border-white/10 glass-inset px-4 py-3 text-sm text-zinc-400">
          <span className="font-mono text-amber-400">
            {formatQueueLine(estimate.waitMin, estimate.aheadCount, locale)}
          </span>{" "}
          {richText(w.estimateLine, {
            barber: <span className="font-semibold text-zinc-200">{assigned?.displayName ?? w.nextFreeBarber}</span>,
            time: <span className="font-mono text-zinc-200">{formatClock(estimate.startsAt, timezone, locale)}</span>,
          })}
        </div>
      </Card>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <Ticket className="size-4 text-amber-500" /> {w.nowServing}
        </h3>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {barbers
            .filter((b) => b.isOnDuty || snapshot.barbers.get(b.id)?.current)
            .map((b) => {
              const live = snapshot.barbers.get(b.id);
              const current = live?.current;
              const code = current ? (current.kind === "ticket" ? current.code : w.booked) : null;
              return (
                <div
                  key={b.id}
                  className={cn(
                    "min-w-[132px] rounded-2xl border p-3",
                    current ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5",
                  )}
                >
                  <p className="text-xs text-zinc-400">{b.displayName}</p>
                  <p className="mt-1 font-mono text-lg font-bold tabular text-zinc-50">{code ?? "—"}</p>
                  <p className={cn("text-[11px]", current ? "text-amber-300/80" : "text-emerald-300/80")}>
                    {current ? format(w.minutesLeft, { n: live?.minutesLeft ?? 0 }) : w.free}
                  </p>
                </div>
              );
            })}
        </div>
      </div>

      {snapshot.waiting.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">{w.inLine}</h3>
          <motion.ul layout className="flex flex-wrap gap-2">
            {snapshot.waiting.slice(0, 12).map((t) => (
              <motion.li layout key={t.id}>
                <Badge mono tone="zinc">
                  {t.code}
                </Badge>
              </motion.li>
            ))}
            {snapshot.waiting.length > 12 && (
              <li>
                <Badge mono>+{snapshot.waiting.length - 12}</Badge>
              </li>
            )}
          </motion.ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-zinc-500">
        {w.footnote}
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="p-4">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </p>
      <motion.p
        key={value}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("mt-1 font-mono text-2xl font-bold tabular", highlight ? "text-amber-400" : "text-zinc-50")}
      >
        {value}
      </motion.p>
    </div>
  );
}
