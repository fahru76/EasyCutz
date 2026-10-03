"use client";

import { CalendarDays, CalendarX2, Clock, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn, formatDuration } from "@/lib/format";
import { isWorkingDay } from "@/lib/slots";
import { addDays, formatClock, formatDayLabel, localDateString } from "@/lib/time";
import type { ApiError, Barber, Shift, ShopSettings, TimeSlot } from "@/lib/types/domain";
import { useBookingStore } from "@/store/booking-store";
import { Button, Skeleton } from "../ui/primitives";
import { TimeSlotPicker } from "./TimeSlotPicker";

interface AvailabilityResponse {
  date: string;
  durationMin: number;
  slots: TimeSlot[];
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: AvailabilityResponse }
  | { kind: "error"; message: string };


export function ScheduleStep({
  settings,
  shifts,
  barbers,
  durationMin,
}: {
  settings: ShopSettings;
  shifts: Shift[];
  barbers: Barber[];
  durationMin: number;
}) {
  const serviceIds = useBookingStore((s) => s.serviceIds);
  const addonIds = useBookingStore((s) => s.addonIds);
  const barberId = useBookingStore((s) => s.barberId);
  const date = useBookingStore((s) => s.date);
  const slot = useBookingStore((s) => s.slot);
  const setDate = useBookingStore((s) => s.setDate);
  const setSlot = useBookingStore((s) => s.setSlot);

  const today = localDateString(new Date(), settings.timezone);
  const candidateIds = useMemo(
    () => (barberId === "any" ? barbers.map((b) => b.id) : [barberId]),
    [barberId, barbers],
  );
  const days = useMemo(
    () =>
      Array.from({ length: settings.bookingHorizonDays + 1 }, (_, i) => {
        const d = addDays(today, i);
        return { date: d, open: isWorkingDay(d, candidateIds, shifts), label: formatDayLabel(d, today) };
      }),
    [today, settings.bookingHorizonDays, candidateIds, shifts],
  );

  // Default to the first open day.
  useEffect(() => {
    if (!date || !days.some((d) => d.date === date && d.open)) {
      const first = days.find((d) => d.open);
      if (first) setDate(first.date);
    }
  }, [date, days, setDate]);

  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: string; outcome: Exclude<LoadState, { kind: "idle" | "loading" }> } | null>(
    null,
  );

  const requestKey = useMemo(() => {
    if (!date || serviceIds.length === 0) return null;
    const params = new URLSearchParams({ date, barber: barberId, services: serviceIds.join(",") });
    if (addonIds.length) params.set("addons", addonIds.join(","));
    return `${params.toString()}#${reloadKey}`;
  }, [date, barberId, serviceIds, addonIds, reloadKey]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const query = requestKey.slice(0, requestKey.lastIndexOf("#"));
    fetch(`/api/availability?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) throw new Error((body as ApiError).message ?? "Couldn't load times");
        setResult({ key: requestKey, outcome: { kind: "ready", data: body as AvailabilityResponse } });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          outcome: { kind: "error", message: err instanceof Error ? err.message : "Couldn't load times" },
        });
      });
    return () => controller.abort();
  }, [requestKey]);

  const state = useMemo<LoadState>(() => {
    if (!requestKey) return { kind: "idle" };
    return result?.key === requestKey ? result.outcome : { kind: "loading" };
  }, [requestKey, result]);

  // Drop a selected slot that's no longer offered (e.g. someone else booked it).
  useEffect(() => {
    if (state.kind === "ready" && slot && !state.data.slots.some((s) => s.startsAt === slot.startsAt)) {
      setSlot(null);
    }
  }, [state, slot, setSlot]);


  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <CalendarDays className="size-4 text-amber-500" /> Date
        </h3>
        <div className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1" role="listbox" aria-label="Date">
          {days.map((d) => {
            const selected = d.date === date;
            return (
              <button
                key={d.date}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={!d.open}
                onClick={() => setDate(d.date)}
                className={cn(
                  "flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl border py-3 transition-all",
                  selected
                    ? "border-amber-500 bg-amber-500 text-zinc-950"
                    : "border-zinc-800/80 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700",
                  !d.open && "cursor-not-allowed border-dashed opacity-35",
                )}
              >
                <span className={cn("text-[11px] font-semibold uppercase", selected ? "text-zinc-900" : "text-zinc-500")}>
                  {d.label.weekday}
                </span>
                <span className="font-mono text-xl font-bold tabular">{d.label.day}</span>
                <span className={cn("text-[10px]", selected ? "text-zinc-800" : "text-zinc-500")}>
                  {d.open ? d.label.month : "Closed"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <span className="flex items-center gap-2">
            <Clock className="size-4 text-amber-500" /> Time
          </span>
          <span className="font-mono text-[11px] normal-case tracking-normal text-zinc-500">
            blocks {formatDuration(durationMin)}
          </span>
        </h3>

        {state.kind === "loading" && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}

        {state.kind === "error" && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
            <p>{state.message}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="size-4" /> Try again
            </Button>
          </div>
        )}

        {state.kind === "ready" && state.data.slots.length === 0 && (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
            <CalendarX2 className="size-8 text-zinc-600" />
            <p className="mt-3 font-semibold text-zinc-300">{date === today ? "No more times today" : "Fully booked"}</p>
            <p className="mt-1 text-sm text-zinc-500">
              No {formatDuration(durationMin)} window left on this day. Try another date
              {barberId !== "any" ? " or First Available" : ""}.
            </p>
          </div>
        )}

        {state.kind === "ready" && state.data.slots.length > 0 && (
          <TimeSlotPicker
            slots={state.data.slots}
            selected={slot}
            onSelect={setSlot}
            timezone={settings.timezone}
            slotIntervalMin={settings.slotIntervalMin}
          />
        )}

        {slot && (
          <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 font-mono text-xs text-amber-200/90">
            Chair reserved {formatClock(slot.startsAt, settings.timezone)} –{" "}
            {formatClock(new Date(new Date(slot.startsAt).getTime() + durationMin * 60000), settings.timezone)}
            {barberId === "any" && slot.availableBarberIds.length > 1 && ` · ${slot.availableBarberIds.length} barbers free`}
          </p>
        )}
      </div>
    </div>
  );
}
