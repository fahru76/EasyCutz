"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, CircleCheck, Clock, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiErrorMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { cn, formatDuration } from "@/lib/format";
import { formatClock, formatShortDateTime, localDateString } from "@/lib/time";
import type { ApiError, Barber, LiveAppointment, PassReschedule as PassRescheduleData, Shift, ShopSettings, TimeSlot } from "@/lib/types/domain";
import { Button, Card } from "../ui/primitives";
import { RescheduleSlotPicker } from "./RescheduleSlotPicker";

/** Customer-side reschedule (EZ-002): held offers first, then free choice when allowed. */
export function PassReschedule({
  token,
  appt,
  data,
  settings,
  shifts,
  barbers,
  autoOpen,
}: {
  token: string;
  appt: LiveAppointment;
  data: PassRescheduleData;
  settings: ShopSettings;
  shifts: Shift[];
  barbers: Barber[];
  autoOpen: boolean;
}) {
  const { t, locale, format } = useI18n();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const barberName = (id: string) => barbers.find((b) => b.id === id)?.displayName ?? t.pass.reschedule.yourBarber;
  const earlier = data.offers.filter((o) => new Date(o.startsAt) < new Date(appt.startsAt));
  const open = autoOpen || data.offers.length > 0 || data.requested;

  async function submit(body: Record<string, unknown>, key: string, label: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${token}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(apiErrorMessage(t, (await res.json()) as ApiError));
        router.refresh();
        return;
      }
      setDone(label);
      setPicking(false);
      router.refresh();
    } catch {
      setError(t.errors.network);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={cn("mt-5 p-5", open && "border-amber-500/40")}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-zinc-100">
            {data.offers.length > 0
              ? earlier.length === data.offers.length
                ? t.pass.reschedule.earlierFree
                : t.pass.reschedule.holdingTimes
              : data.requested
                ? t.pass.reschedule.pleasePick
                : t.pass.reschedule.needDifferent}
          </p>
          {data.movedFrom && (
            <p className="text-xs text-zinc-500">
              {format(t.pass.reschedule.movedFrom, { when: formatShortDateTime(data.movedFrom, settings.timezone, locale) })}
            </p>
          )}
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
          >
            <CircleCheck className="size-4" /> {format(t.pass.reschedule.movedTo, { when: done })}
          </motion.p>
        )}
      </AnimatePresence>

      {data.offers.length > 0 && (
        <div className="mt-4 space-y-2">
          {data.offers.map((o) => {
            const isEarlier = new Date(o.startsAt) < new Date(appt.startsAt);
            const label = `${formatShortDateTime(o.startsAt, settings.timezone, locale)} · ${barberName(o.barberId)}`;
            return (
              <Button
                key={o.id}
                variant={isEarlier ? "primary" : "secondary"}
                className="w-full justify-between"
                loading={busy === o.id}
                disabled={busy !== null}
                onClick={() => void submit({ offerId: o.id }, o.id, label)}
              >
                <span className="flex items-center gap-2">
                  {isEarlier ? <Zap className="size-4" /> : <Clock className="size-4" />}
                  {isEarlier ? t.pass.reschedule.moveEarlier : ""}
                  {label}
                </span>
              </Button>
            );
          })}
          <p className="text-[11px] text-zinc-500">
            {format(t.pass.reschedule.heldUntil, { time: formatClock(data.offers[0]!.expiresAt, settings.timezone, locale) })}
            {earlier.length > 0
              ? format(t.pass.reschedule.orKeep, { time: formatClock(appt.startsAt, settings.timezone, locale) })
              : "."}
          </p>
        </div>
      )}

      {data.allowed ? (
        <div className="mt-4">
          {!picking ? (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="text-sm font-semibold text-amber-400 underline-offset-4 hover:underline"
            >
              {data.offers.length > 0 ? t.pass.reschedule.noneWork : t.pass.reschedule.pickAnother}
            </button>
          ) : (
            <div className="mt-2">
              <RescheduleSlotPicker
                settings={settings}
                shifts={shifts}
                barbers={barbers}
                serviceIds={data.serviceIds}
                addonIds={data.addonIds}
                durationMin={appt.durationMin}
                originalBarberId={appt.barberId}
                ignoreAppointmentId={appt.id}
          initialDate={localDateString(new Date(appt.startsAt), settings.timezone)}
                busy={busy === "pick"}
                onConfirm={(slot: TimeSlot, barberId: string) =>
                  void submit(
                    { startsAt: slot.startsAt, barberId },
                    "pick",
                    `${formatShortDateTime(slot.startsAt, settings.timezone, locale)} · ${barberName(barberId)}`,
                  )
                }
              />
            </div>
          )}
        </div>
      ) : (
        data.offers.length === 0 && (
          <p className="mt-3 text-sm text-zinc-500">
            {format(t.pass.reschedule.cutoff, { duration: formatDuration(data.cutoffMin, locale) })}
          </p>
        )
      )}

      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </Card>
  );
}
