"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Moon, Sun, Sunrise, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Messages } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/format";
import { buildTimeGrid, dayPartOf, type DayPart } from "@/lib/slots";
import { formatClock } from "@/lib/time";
import type { TimeSlot } from "@/lib/types/domain";

const PART_ICONS: Record<DayPart, ReactNode> = {
  morning: <Sunrise className="size-4" />,
  afternoon: <Sun className="size-4" />,
  evening: <Moon className="size-4" />,
};

function hourLabel(hour: number, t: Messages): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? t.booking.slots.am : t.booking.slots.pm}`;
}

/**
 * Compact time picker: day-part tabs + one row per hour (`2 PM │ :00 :15 :30 :45`).
 * A whole day part fits on one phone screen; taken times stay visible as gaps
 * so the grid reads like a timetable instead of a long list.
 */
export function TimeSlotPicker({
  slots,
  selected,
  onSelect,
  timezone,
  slotIntervalMin,
}: {
  slots: TimeSlot[];
  selected: TimeSlot | null;
  onSelect: (slot: TimeSlot) => void;
  timezone: string;
  slotIntervalMin: number;
}) {
  const { t, locale, format } = useI18n();
  const parts = t.booking.slots.parts;
  const grid = useMemo(() => buildTimeGrid(slots, slotIntervalMin), [slots, slotIntervalMin]);
  const [chosenPart, setChosenPart] = useState<DayPart | null>(null);

  // Active tab: the user's choice if it has times, else the selected slot's part, else the first open part.
  const fallback =
    (selected && grid.find((g) => g.part === dayPartOf(selected.localMinute) && g.available > 0)?.part) ??
    grid.find((g) => g.available > 0)?.part ??
    "morning";
  const activePart =
    chosenPart && (grid.find((g) => g.part === chosenPart)?.available ?? 0) > 0 ? chosenPart : fallback;
  const active = grid.find((g) => g.part === activePart);
  const earliest = slots[0] ?? null;

  if (!earliest) return null;

  return (
    <div className="space-y-4">
      {/* Quick pick */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setChosenPart(dayPartOf(earliest.localMinute));
            onSelect(earliest);
          }}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
            selected?.startsAt === earliest.startsAt
              ? "border-amber-500 bg-amber-500 text-zinc-950"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
          )}
        >
          <Zap className="size-4" />
          {t.booking.slots.earliest} · <span className="font-mono">{formatClock(earliest.startsAt, timezone, locale)}</span>
        </button>
        <span className="font-mono text-xs text-zinc-500">{format(t.booking.slots.open, { n: slots.length })}</span>
      </div>

      {/* Day-part tabs */}
      <LayoutGroup id="daypart-tabs">
        <div role="tablist" aria-label={t.booking.slots.partsAria} className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 glass-inset p-1">
          {grid.map((g) => {
            const isActive = g.part === activePart;
            const empty = g.available === 0;
            return (
              <button
                key={g.part}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={empty}
                onClick={() => setChosenPart(g.part)}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-semibold transition-colors",
                  isActive ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-200",
                  empty && "cursor-not-allowed opacity-35",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="daypart-pill"
                    className="absolute inset-0 rounded-xl bg-amber-500"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {PART_ICONS[g.part]}
                  {parts[g.part]}
                </span>
                <span className={cn("relative font-mono text-[10px]", isActive ? "text-zinc-900/80" : "text-zinc-500")}>
                  {empty ? t.booking.slots.full : format(t.booking.slots.open, { n: g.available })}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Hour rows */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activePart}
          role="tabpanel"
          aria-label={format(t.booking.slots.partTimesAria, { part: parts[activePart] })}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="space-y-2"
        >
          {active?.rows.map((row) => (
            <div key={row.hour} className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-xs font-semibold text-zinc-400">{hourLabel(row.hour, t)}</span>
              <div
                className="grid flex-1 gap-1.5"
                style={{ gridTemplateColumns: `repeat(${row.cells.length}, minmax(0, 1fr))` }}
              >
                {row.cells.map((cell) =>
                  cell.slot ? (
                    <motion.button
                      key={cell.minute}
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      aria-pressed={selected?.startsAt === cell.slot.startsAt}
                      aria-label={formatClock(cell.slot.startsAt, timezone, locale)}
                      onClick={() => cell.slot && onSelect(cell.slot)}
                      className={cn(
                        "h-11 rounded-xl border font-mono text-sm font-semibold tabular transition-colors",
                        selected?.startsAt === cell.slot.startsAt
                          ? "border-amber-500 bg-amber-500 text-zinc-950 shadow-[0_6px_20px_-8px_rgb(245_158_11/0.8)]"
                          : "border-white/10 glass text-zinc-100 hover:border-amber-500/50",
                      )}
                    >
                      :{String(cell.minute).padStart(2, "0")}
                    </motion.button>
                  ) : (
                    <span
                      key={cell.minute}
                      aria-hidden
                      className="flex h-11 items-center justify-center rounded-xl border border-dashed border-white/10 font-mono text-xs text-zinc-700 line-through"
                    >
                      :{String(cell.minute).padStart(2, "0")}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>

      <p className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded border border-white/15 bg-white/[0.05]" /> {t.booking.slots.legendOpen}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded border border-dashed border-white/15" /> {t.booking.slots.legendTaken}
        </span>
      </p>
    </div>
  );
}
