"use client";

import { CalendarDays, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn, formatDuration } from "@/lib/format";
import { isWorkingDay } from "@/lib/slots";
import { addDays, formatDayLabel, formatShortDateTime, localDateString } from "@/lib/time";
import type { ApiError, Barber, Shift, ShopSettings, TimeSlot } from "@/lib/types/domain";
import { TimeSlotPicker } from "../booking/TimeSlotPicker";
import { Button, Skeleton } from "../ui/primitives";

interface AvailabilityResponse {
  slots: TimeSlot[];
}

/**
 * Pick a new time for an existing booking (EZ-002). Uses the same availability
 * API as booking, ignoring the booking itself so neighbouring times show as free.
 */
export function RescheduleSlotPicker({
  settings,
  shifts,
  barbers,
  serviceIds,
  addonIds,
  durationMin,
  originalBarberId,
  ignoreAppointmentId,
  busy,
  onConfirm,
}: {
  settings: ShopSettings;
  shifts: Shift[];
  barbers: Barber[];
  serviceIds: string[];
  addonIds: string[];
  durationMin: number;
  originalBarberId: string;
  ignoreAppointmentId: string;
  busy: boolean;
  onConfirm: (slot: TimeSlot, barberId: string) => void;
}) {
  const [anyBarber, setAnyBarber] = useState(false);
  const today = localDateString(new Date(), settings.timezone);
  const candidateIds = useMemo(
    () => (anyBarber ? barbers.map((b) => b.id) : [originalBarberId]),
    [anyBarber, barbers, originalBarberId],
  );
  const days = useMemo(
    () =>
      Array.from({ length: settings.bookingHorizonDays + 1 }, (_, i) => {
        const d = addDays(today, i);
        return { date: d, open: isWorkingDay(d, candidateIds, shifts), label: formatDayLabel(d, today) };
      }),
    [today, settings.bookingHorizonDays, candidateIds, shifts],
  );
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const date = chosenDate && days.some((d) => d.date === chosenDate && d.open) ? chosenDate : (days.find((d) => d.open)?.date ?? null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: string; slots: TimeSlot[] | null; error: string | null } | null>(null);

  const requestKey = useMemo(() => {
    if (!date) return null;
    const p = new URLSearchParams({
      date,
      barber: anyBarber ? "any" : originalBarberId,
      services: serviceIds.join(","),
      ignore: ignoreAppointmentId,
    });
    if (addonIds.length) p.set("addons", addonIds.join(","));
    return `${p.toString()}#${reloadKey}`;
  }, [date, anyBarber, originalBarberId, serviceIds, addonIds, ignoreAppointmentId, reloadKey]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    fetch(`/api/availability?${requestKey.slice(0, requestKey.lastIndexOf("#"))}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) throw new Error((body as ApiError).message ?? "Couldn't load times");
        setResult({ key: requestKey, slots: (body as AvailabilityResponse).slots, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, slots: null, error: err instanceof Error ? err.message : "Couldn't load times" });
      });
    return () => controller.abort();
  }, [requestKey]);

  const loaded = result && result.key === requestKey ? result : null;
  const slots = loaded?.slots ?? null;
  const selected = slot && slots?.some((s) => s.startsAt === slot.startsAt) ? slot : null;
  const barberName = (id: string) => barbers.find((b) => b.id === id)?.displayName ?? "barber";
  const chosenBarber = selected
    ? selected.availableBarberIds.includes(originalBarberId)
      ? originalBarberId
      : (selected.availableBarberIds[0] ?? originalBarberId)
    : originalBarberId;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Barber" className="grid grid-cols-2 gap-1 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-1 text-sm font-semibold">
        {[false, true].map((any) => (
          <button
            key={String(any)}
            type="button"
            role="radio"
            aria-checked={anyBarber === any}
            onClick={() => {
              setAnyBarber(any);
              setSlot(null);
            }}
            className={cn("rounded-xl py-2", anyBarber === any ? "bg-amber-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-200")}
          >
            {any ? "Any barber" : `Keep ${barberName(originalBarberId)}`}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <CalendarDays className="size-4 text-amber-500" /> Date
          <span className="ml-auto font-mono normal-case tracking-normal text-zinc-500">blocks {formatDuration(durationMin)}</span>
        </p>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="New date">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              role="option"
              aria-selected={d.date === date}
              disabled={!d.open}
              onClick={() => {
                setChosenDate(d.date);
                setSlot(null);
              }}
              className={cn(
                "flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 text-xs",
                d.date === date ? "border-amber-500 bg-amber-500 text-zinc-950" : "border-zinc-800 bg-zinc-900/60 text-zinc-300",
                !d.open && "cursor-not-allowed border-dashed opacity-35",
              )}
            >
              <span className="font-semibold uppercase">{d.label.weekday}</span>
              <span className="font-mono text-lg font-bold">{d.label.day}</span>
            </button>
          ))}
        </div>
      </div>

      {!loaded && <Skeleton className="h-40" />}
      {loaded?.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">
          {loaded.error}
          <Button variant="secondary" size="sm" className="ml-3" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="size-4" /> Retry
          </Button>
        </div>
      )}
      {slots && slots.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">
          No free {formatDuration(durationMin)} window this day{anyBarber ? "" : " — try “Any barber” or another date"}.
        </p>
      )}
      {slots && slots.length > 0 && (
        <TimeSlotPicker
          slots={slots}
          selected={selected}
          onSelect={setSlot}
          timezone={settings.timezone}
          slotIntervalMin={settings.slotIntervalMin}
        />
      )}

      <Button
        size="lg"
        className="w-full"
        disabled={!selected}
        loading={busy}
        onClick={() => selected && onConfirm(selected, chosenBarber)}
      >
        {selected
          ? `Move to ${formatShortDateTime(selected.startsAt, settings.timezone)} · ${barberName(chosenBarber)}`
          : "Pick a new time"}
      </Button>
    </div>
  );
}
