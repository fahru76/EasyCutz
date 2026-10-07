"use client";

import { motion } from "framer-motion";
import { Check, Star, Zap } from "lucide-react";
import { formatWait, cn } from "@/lib/format";
import { barberStatusLabel, type QueueSnapshot } from "@/lib/queue";
import type { Barber, BookingMode } from "@/lib/types/domain";
import { useBookingStore } from "@/store/booking-store";
import { Avatar, Badge, SectionTitle, type BadgeTone } from "../ui/primitives";

function toneFor(state: string | undefined): BadgeTone {
  switch (state) {
    case "available":
      return "emerald";
    case "in_chair":
      return "amber";
    case "busy":
      return "sky";
    case "on_break":
      return "rose";
    default:
      return "zinc";
  }
}

export function BarberRoster({
  barbers,
  snapshot,
  mode,
  timezone,
}: {
  barbers: Barber[];
  snapshot: QueueSnapshot;
  mode: BookingMode;
  timezone: string;
}) {
  const barberId = useBookingStore((s) => s.barberId);
  const setBarber = useBookingStore((s) => s.setBarber);
  const anyWait = snapshot.nextWalkIn?.waitMin ?? null;

  return (
    <section aria-labelledby="barber-title">
      <SectionTitle
        eyebrow="Step 2"
        title="Pick your barber"
        action={<span className="text-xs text-zinc-500 sm:hidden">Swipe →</span>}
      />

      <div
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2"
        role="radiogroup"
        aria-label="Barber"
      >
        {/* First available */}
        <motion.button
          type="button"
          role="radio"
          aria-checked={barberId === "any"}
          whileTap={{ scale: 0.97 }}
          onClick={() => setBarber("any")}
          className={cn(
            "relative flex w-[78%] max-w-[260px] shrink-0 snap-start flex-col rounded-3xl border p-5 text-left transition-all sm:w-60",
            barberId === "any"
              ? "border-amber-500/70 bg-gradient-to-br from-amber-500/15 to-zinc-900/60"
              : "border-white/10 glass hover:border-white/15",
          )}
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950">
            <Zap className="size-7" strokeWidth={2.5} />
          </span>
          <p className="mt-4 text-lg font-bold text-zinc-50">First Available</p>
          <p className="text-sm text-zinc-400">Fastest chair, best for walk-ins</p>
          <div className="mt-4">
            {anyWait === null ? (
              <Badge tone="zinc">Queue closed</Badge>
            ) : (
              <Badge tone={anyWait <= 1 ? "emerald" : "amber"} pulse mono>
                {anyWait <= 1 ? "Chair free now" : `${formatWait(anyWait)} wait`}
              </Badge>
            )}
          </div>
          {barberId === "any" && <SelectedTick />}
        </motion.button>

        {barbers.map((barber) => {
          const live = snapshot.barbers.get(barber.id);
          const offDuty = !barber.isOnDuty;
          const disabled = mode === "walk_in" && offDuty;
          const selected = barberId === barber.id;
          return (
            <motion.button
              key={barber.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled}
              whileTap={disabled ? undefined : { scale: 0.97 }}
              onClick={() => !disabled && setBarber(barber.id)}
              className={cn(
                "relative flex w-[78%] max-w-[260px] shrink-0 snap-start flex-col rounded-3xl border p-5 text-left transition-all sm:w-60",
                selected
                  ? "border-amber-500/70 bg-amber-500/[0.07]"
                  : "border-white/10 glass hover:border-white/15",
                disabled && "cursor-not-allowed opacity-45",
              )}
            >
              <Avatar name={barber.displayName} src={barber.avatarUrl} />
              <p className="mt-4 text-lg font-bold text-zinc-50">{barber.displayName}</p>
              <p className="line-clamp-1 text-sm text-zinc-400">{barber.specialty}</p>
              <p className="mt-2 flex items-center gap-1 text-sm text-zinc-300">
                <Star className="size-4 fill-amber-400 text-amber-400" />
                <span className="font-mono tabular">{barber.rating.toFixed(1)}</span>
                <span className="text-zinc-500">({barber.reviewCount})</span>
              </p>
              <div className="mt-3">
                <Badge tone={toneFor(offDuty && live?.state !== "in_chair" ? "off_duty" : live?.state)} pulse={!offDuty} mono>
                  {offDuty && live?.state !== "in_chair" ? "Off Duty" : barberStatusLabel(live, timezone)}
                </Badge>
              </div>
              {mode === "scheduled" && offDuty && (
                <p className="mt-2 text-[11px] text-zinc-500">Bookable for later dates</p>
              )}
              {selected && <SelectedTick />}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function SelectedTick() {
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="absolute right-4 top-4 flex size-7 items-center justify-center rounded-full bg-amber-500 text-zinc-950"
    >
      <Check className="size-4" strokeWidth={3} />
    </motion.span>
  );
}
