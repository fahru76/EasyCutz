"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Armchair,
  CalendarClock,
  CircleCheck,
  Coffee,
  LogOut,
  Hourglass,
  Megaphone,
  MessageCircle,
  MessageSquare,
  ScanLine,
  Settings2,
  Undo2,
  UserCheck,
  UserX,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveSettings } from "@/hooks/use-live-settings";
import { useLiveShop } from "@/hooks/use-live-shop";
import { useNow } from "@/hooks/use-now";
import { cn, formatMoney, formatWait } from "@/lib/format";
import { calledNowMessage, delayMessage, freeEarlyMessage, rescheduledMessage, smsLink, turnSoonMessage, whatsappLink } from "@/lib/notify";
import { buildQueueSnapshot, chairBlocksForDay, type AppointmentEta, type QueueSnapshot } from "@/lib/queue";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { formatClock, formatShortDateTime } from "@/lib/time";
import {
  mapContact,
  type Barber,
  type BookingContact,
  type BookingKind,
  type LiveAppointment,
  type LiveBooking,
  type LiveTicket,
  type Shift,
  type ShopSettings,
} from "@/lib/types/domain";
import { DeskReschedule, type MovedBooking } from "../reschedule/DeskReschedule";
import { ClosurePanel } from "./ClosurePanel";
import { SiteHeader } from "../ui/SiteHeader";
import { Avatar, Badge, Button, Card, Switch, type BadgeTone } from "../ui/primitives";

type Action = "seat" | "complete" | "no_show" | "requeue";

const APPT_LIVE = new Set(["pending_payment", "confirmed", "checked_in", "called"]);

export function DeskBoard({
  settings: initialSettings,
  initialBarbers,
  shifts,
  staffName,
  isOwner,
  origin,
}: {
  settings: ShopSettings;
  initialBarbers: Barber[];
  shifts: Shift[];
  staffName: string;
  isOwner: boolean;
  origin: string;
}) {
  const router = useRouter();
  // EZ-001: closure state (and owner edits) arrive live.
  const settings = useLiveSettings(initialSettings, "desk-settings");
  const tick = useNow(10_000);
  const live = useLiveShop({ initialBarbers, timezone: settings.timezone, channelName: "desk-live" });
  // Data refreshed after a desk action is newer than the 10-s tick: never judge it with a stale clock.
  const now = live.lastUpdated && live.lastUpdated > tick ? live.lastUpdated : tick;
  const snapshot = useMemo(
    () =>
      buildQueueSnapshot({
        now,
        barbers: live.barbers,
        tickets: live.tickets,
        appointments: live.appointments,
        blocks: chairBlocksForDay(now, settings.timezone, live.breaks, live.timeOff),
        bufferMin: settings.bufferAfterServiceMin,
      }),
    [now, live.barbers, live.tickets, live.appointments, live.breaks, live.timeOff, settings.timezone, settings.bufferAfterServiceMin],
  );

  // ---- contacts (staff-only via RLS) ------------------------------------------
  const [contacts, setContacts] = useState<Map<string, BookingContact>>(new Map());
  const idsKey = useMemo(
    () => [...live.tickets.map((t) => t.id), ...live.appointments.map((a) => a.id)].sort().join(","),
    [live.tickets, live.appointments],
  );
  useEffect(() => {
    const ticketIds = live.tickets.map((t) => t.id);
    const apptIds = live.appointments.map((a) => a.id);
    if (ticketIds.length + apptIds.length === 0) return;
    let cancelled = false;
    const db = getBrowserSupabase();
    const filters = [
      ticketIds.length ? `ticket_id.in.(${ticketIds.join(",")})` : null,
      apptIds.length ? `appointment_id.in.(${apptIds.join(",")})` : null,
    ].filter(Boolean);
    void db
      .from("booking_private")
      .select("*")
      .or(filters.join(","))
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setContacts(new Map((data ?? []).map((row) => {
          const c = mapContact(row);
          return [c.bookingId, c] as const;
        })));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey captures the id set
  }, [idsKey]);

  // ---- actions ------------------------------------------------------------------
  const [pending, setPending] = useState<string | null>(null);
  const [lastMoved, setLastMoved] = useState<MovedBooking | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const run = useCallback(
    async (key: string, fn: () => Promise<{ error: { message: string } | null }>, okText?: string) => {
      setPending(key);
      try {
        const { error } = await fn();
        if (error) setToast({ tone: "error", text: deskErrorText(error.message) });
        else if (okText) setToast({ tone: "ok", text: okText });
        await live.refresh();
      } finally {
        setPending(null);
      }
    },
    [live],
  );

  const db = getBrowserSupabase();
  const callNext = (barber: Barber) =>
    run(`call:${barber.id}`, async () => {
      const res = await db.rpc("desk_call_next", { p_barber_id: barber.id });
      if (!res.error && res.data === null) {
        setToast({ tone: "ok", text: `Nobody waiting for ${barber.displayName}.` });
      }
      const noFit = !res.error ? parseNoFit(res.data) : null;
      if (noFit) {
        const when = noFit.nextStartsAt ? ` (${formatClock(noFit.nextStartsAt, settings.timezone)})` : "";
        setToast({
          tone: "error",
          text: `Next walk-in needs ${noFit.neededMin} min, only ${noFit.gapMin ?? 0} min free before ${noFit.nextLabel ?? "the next booking"}${when}. ${
            noFit.nextLabel === "a break" ? "Call them after the break." : "Seat the booked customer early or wait."
          }`,
        });
      }
      return res;
    });
  const setExpectedEnd = (booking: LiveBooking, mode: "extend" | "finish_in", minutes: number) =>
    run(
      `eta:${booking.id}`,
      async () => db.rpc("desk_set_expected_end", { p_kind: booking.kind, p_id: booking.id, p_mode: mode, p_minutes: minutes }),
      mode === "extend" ? `+${minutes} min added — ETAs updated` : `Done in ~${minutes} min — ETAs updated`,
    );
  const markDelayNotified = (appointmentId: string, delayMin: number) =>
    run(`delay:${appointmentId}`, async () =>
      db.rpc("desk_mark_delay_notified", { p_appointment_id: appointmentId, p_delay_min: delayMin }),
    );
  const transition = (kind: BookingKind, id: string, action: Action, barberId?: string) =>
    run(`${action}:${id}`, async () =>
      db.rpc("desk_transition", { p_kind: kind, p_id: id, p_action: action, p_barber_id: barberId ?? null }),
    );
  const checkIn = (token: string) => run(`checkin:${token}`, async () => db.rpc("desk_check_in", { p_token: token }), "Checked in");
  // EZ-003: ad-hoc breaks from the desk
  const takeBreak = (barber: Barber, minutes: number) =>
    run(`break:${barber.id}`, async () => db.rpc("desk_take_break", { p_barber_id: barber.id, p_minutes: minutes }),
      `${barber.displayName} is on a ${minutes}-min break`);
  const endBreak = (barber: Barber) =>
    run(`break:${barber.id}`, async () => db.rpc("desk_end_break", { p_barber_id: barber.id }), `${barber.displayName} is back`);
  const setDuty = (barber: Barber, on: boolean) =>
    run(`duty:${barber.id}`, async () => db.rpc("desk_set_duty", { p_barber_id: barber.id, p_on_duty: on }));
  const markNotified = (ticketId: string) =>
    run(`notify:${ticketId}`, async () => db.rpc("desk_mark_notified", { p_ticket_id: ticketId }));

  async function signOut() {
    await db.auth.signOut();
    router.replace("/desk/login");
    router.refresh();
  }

  // ---- derived lists --------------------------------------------------------------
  const barberById = new Map(live.barbers.map((b) => [b.id, b]));
  const waiting = snapshot.waiting;
  const upcoming = live.appointments
    .filter((a) => APPT_LIVE.has(a.status) && a.status !== "called")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const doneCount =
    live.tickets.filter((t) => t.status === "completed").length +
    live.appointments.filter((a) => a.status === "completed").length;
  const inChairCount = [...snapshot.barbers.values()].filter((b) => b.current).length;
  const appointmentsById = new Map(live.appointments.map((a) => [a.id, a]));
  const delayed = upcoming
    .map((a) => ({ appt: a, eta: snapshot.appointmentEtas.get(a.id) }))
    .filter((d): d is { appt: LiveAppointment; eta: AppointmentEta } =>
      Boolean(d.eta && d.eta.delayMin >= settings.delayNotifyMin && d.appt.status !== "pending_payment"),
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        languageSwitch={false}
        wide
        shopName={settings.shopName}
        status={live.status}
        right={
          <div className="flex items-center gap-2">
            {isOwner && (
              <Link
                href="/desk/admin"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-sm font-semibold text-zinc-300 hover:border-white/15 hover:text-zinc-100"
              >
                <Settings2 className="size-4" /> Admin
              </Link>
            )}
            <span className="hidden text-sm text-zinc-400 sm:inline">{staffName}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 text-zinc-400 hover:text-zinc-100"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        }
      />

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500">Quick-Desk</p>
            <h1 className="text-2xl font-bold tracking-tight">Live floor</h1>
          </div>
          <div className="grid grid-cols-4 gap-2 font-mono">
            <Stat label="Waiting" value={waiting.length} tone="amber" />
            <Stat label="Booked" value={upcoming.length} tone="sky" />
            <Stat label="In chair" value={inChairCount} tone="emerald" />
            <Stat label="Done" value={doneCount} tone="zinc" />
          </div>
        </div>

        {live.error && (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">
            Couldn&apos;t refresh: {live.error}
          </p>
        )}

        <ClosurePanel
          settings={settings}
          shifts={shifts}
          barbers={live.barbers}
          origin={origin}
          waitingCount={waiting.length}
          onChanged={() => void live.refresh()}
        />

        {/* Chairs */}
        <section aria-label="Chairs" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {live.barbers.map((barber) => (
            <ChairCard
              key={barber.id}
              barber={barber}
              snapshot={snapshot}
              contacts={contacts}
              settings={settings}
              now={now}
              origin={origin}
              shifts={shifts}
              barbers={live.barbers}
              onChanged={() => void live.refresh()}
              onMoved={setLastMoved}
              appointmentsById={appointmentsById}
              pending={pending}
              onCallNext={() => void callNext(barber)}
              onTransition={(kind, id, action) => void transition(kind, id, action, barber.id)}
              onAdjust={(booking, mode, minutes) => void setExpectedEnd(booking, mode, minutes)}
              onDuty={(on) => void setDuty(barber, on)}
              deskBreak={live.timeOff.some(
                (t) => t.barberId === barber.id && t.kind === "break" && new Date(t.startsAt) <= now && new Date(t.endsAt) > now,
              )}
              onTakeBreak={(minutes) => void takeBreak(barber, minutes)}
              onEndBreak={() => void endBreak(barber)}
            />
          ))}
        </section>

        {lastMoved && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <CircleCheck className="size-5 shrink-0" />
            <p className="flex-1">
              Moved <span className="font-semibold">{lastMoved.customerName}</span> to{" "}
              <span className="font-mono">{formatShortDateTime(lastMoved.startsAt, settings.timezone)}</span> with {lastMoved.barberName}.
            </p>
            {lastMoved.phone && lastMoved.passUrl && (
              <a
                href={whatsappLink(
                  lastMoved.phone,
                  rescheduledMessage({
                    shopName: settings.shopName,
                    customerName: lastMoved.customerName,
                    barberName: lastMoved.barberName,
                    newTime: formatShortDateTime(lastMoved.startsAt, settings.timezone),
                    passUrl: lastMoved.passUrl,
                  }),
                )}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 font-semibold text-zinc-950"
              >
                <MessageCircle className="size-4" /> Send confirmation
              </a>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setLastMoved(null)} className="text-emerald-200/70 hover:text-emerald-100">
              ✕
            </button>
          </div>
        )}

        {delayed.length > 0 && (
          <section aria-label="Delayed bookings">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-400">
              <Hourglass className="size-4" /> Delayed bookings
            </h2>
            <Card className="divide-y divide-zinc-800/70 border-amber-500/30">
              {delayed.map(({ appt, eta }) => (
                <DelayedRow
                  key={appt.id}
                  appt={appt}
                  eta={eta}
                  contact={contacts.get(appt.id)}
                  barber={barberById.get(appt.barberId)}
                  settings={settings}
                  origin={origin}
                  shifts={shifts}
                  barbers={live.barbers}
                  onChanged={() => void live.refresh()}
                  onMoved={setLastMoved}
                  pending={pending}
                  onNotified={() => void markDelayNotified(appt.id, eta.delayMin)}
                />
              ))}
            </Card>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Walk-in queue */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              <Users className="size-4 text-amber-500" /> Walk-in queue
            </h2>
            <Card className="divide-y divide-zinc-800/70">
              {waiting.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">Queue is empty.</p>}
              <AnimatePresence initial={false}>
                {waiting.map((t) => (
                  <QueueRow
                    key={t.id}
                    ticket={t}
                    eta={snapshot.etas.get(t.id)}
                    contact={contacts.get(t.id)}
                    barbers={live.barbers}
                    barberById={barberById}
                    snapshot={snapshot}
                    settings={settings}
                    origin={origin}
                    pending={pending}
                    onSeat={(barberId) => void transition("ticket", t.id, "seat", barberId)}
                    onNoShow={() => void transition("ticket", t.id, "no_show")}
                    onNotified={() => void markNotified(t.id)}
                  />
                ))}
              </AnimatePresence>
            </Card>
          </section>

          {/* Appointments */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              <CalendarClock className="size-4 text-amber-500" /> Booked today
            </h2>
            <Card className="divide-y divide-zinc-800/70">
              {upcoming.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">No more bookings today.</p>}
              {upcoming.map((a) => (
                <AppointmentRow
                  key={a.id}
                  appt={a}
                  contact={contacts.get(a.id)}
                  barber={barberById.get(a.barberId)}
                  eta={snapshot.appointmentEtas.get(a.id)}
                  settings={settings}
                  origin={origin}
                  shifts={shifts}
                  barbers={live.barbers}
                  onChanged={() => void live.refresh()}
                  onMoved={setLastMoved}
                  now={now}
                  pending={pending}
                  onCheckIn={(token) => void checkIn(token)}
                  onSeat={() => void transition("appointment", a.id, "seat")}
                  onNoShow={() => void transition("appointment", a.id, "no_show")}
                />
              ))}
            </Card>
          </section>
        </div>

        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <ScanLine className="size-4" /> Customers can show their pass QR — scanning it on this device opens check-in.
        </p>
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn(
              "fixed inset-x-4 bottom-6 z-50 mx-auto max-w-sm rounded-2xl border p-4 text-center text-sm shadow-2xl backdrop-blur",
              toast.tone === "ok"
                ? "border-emerald-500/40 glass-strong text-emerald-200"
                : "border-rose-500/40 glass-strong text-rose-200",
            )}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// -------------------------------------------------------------------------------------
function deskErrorText(code: string): string {
  const map: Record<string, string> = {
    forbidden: "Your account isn't set up as staff.",
    chair_busy: "That chair already has a customer.",
    invalid_transition: "That action no longer applies — the board has been refreshed.",
    barber_required: "Pick a barber first.",
    not_found: "Booking not found.",
    barber_unavailable: "That barber isn't active.",
    shop_closed: "The shop is closed — reopen it first.",
    on_break: "That barber is on a break — tap “Back now” first.",
    already_on_break: "That barber is already on a break.",
    invalid_value: "That value isn't allowed.",
  };
  return map[code] ?? `Action failed (${code}).`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  const color: Record<BadgeTone, string> = {
    amber: "text-amber-400",
    sky: "text-sky-300",
    emerald: "text-emerald-400",
    zinc: "text-zinc-300",
    rose: "text-rose-300",
  };
  return (
    <div className="min-w-[72px] rounded-xl border border-white/10 glass px-3 py-2 text-center">
      <p className={cn("text-xl font-bold tabular", color[tone])}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

function bookingLabel(b: LiveBooking, contact: BookingContact | undefined): { code: string; name: string } {
  return {
    code: b.kind === "ticket" ? b.code : "APPT",
    name: contact?.customerName ?? b.displayName,
  };
}

function ChairCard({
  barber,
  snapshot,
  contacts,
  settings,
  now,
  origin,
  shifts,
  barbers,
  onChanged,
  onMoved,
  appointmentsById,
  pending,
  onCallNext,
  onTransition,
  onAdjust,
  onDuty,
  deskBreak,
  onTakeBreak,
  onEndBreak,
}: {
  barber: Barber;
  snapshot: QueueSnapshot;
  contacts: Map<string, BookingContact>;
  settings: ShopSettings;
  now: Date;
  origin: string;
  shifts: Shift[];
  barbers: Barber[];
  onChanged: () => void;
  onMoved: (moved: MovedBooking) => void;
  appointmentsById: Map<string, LiveAppointment>;
  pending: string | null;
  onCallNext: () => void;
  onTransition: (kind: BookingKind, id: string, action: Action) => void;
  onAdjust: (booking: LiveBooking, mode: "extend" | "finish_in", minutes: number) => void;
  onDuty: (on: boolean) => void;
  /** The active break was started from the desk (can be ended early). */
  deskBreak: boolean;
  onTakeBreak: (minutes: number) => void;
  onEndBreak: () => void;
}) {
  const live = snapshot.barbers.get(barber.id);
  const onBreak = live?.onBreak ?? null;
  const nextBreak = live?.nextBreak ?? null;
  const breakSoonMin = nextBreak ? Math.round((nextBreak.start.getTime() - now.getTime()) / 60000) : null;
  const current = live?.current ?? null;
  const called = live?.called ?? null;
  const over = live?.runningOverMin ?? 0;
  const nextEta = live?.nextAppointment ?? null;
  const nextAppt = nextEta ? appointmentsById.get(nextEta.appointmentId) : undefined;
  const nextContact = nextAppt ? contacts.get(nextAppt.id) : undefined;
  const nextName = (nextContact?.customerName ?? nextAppt?.displayName ?? "").split(/\s+/)[0] ?? "";
  const freeGap = live?.freeGapMin ?? null;
  const progress = current
    ? Math.min(1, Math.max(0, (now.getTime() - new Date(current.seatedAt ?? now.toISOString()).getTime()) / (current.durationMin * 60000)))
    : 0;

  return (
    <Card className={cn("flex flex-col p-4", !barber.isOnDuty && "opacity-60")}>
      <div className="flex items-center gap-3">
        <Avatar name={barber.displayName} src={barber.avatarUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{barber.displayName}</p>
          <p className="font-mono text-[11px] text-zinc-500">Prefix {barber.ticketPrefix}</p>
        </div>
        <Switch checked={barber.isOnDuty} onChange={onDuty} label={`${barber.displayName} on duty`} disabled={pending === `duty:${barber.id}`} />
      </div>

      <div className="mt-4 min-h-[112px] flex-1 rounded-xl border border-white/10 glass-inset p-3">
        {current ? (
          <>
            <div className="flex items-center justify-between">
              <Badge tone="emerald" pulse>
                <Armchair className="size-3" /> In chair
              </Badge>
              {over > 0 ? (
                <span className={cn("font-mono text-xs font-semibold", over > 15 ? "text-rose-300" : "text-amber-300")}>
                  +{over}m over
                </span>
              ) : (
                <span className="font-mono text-xs text-zinc-400">
                  {live?.minutesLeft ?? 0}m left
                  {live?.expectedEndAt && <> · {formatClock(live.expectedEndAt, settings.timezone)}</>}
                </span>
              )}
            </div>
            <p className="mt-2 font-mono text-lg font-bold">{bookingLabel(current, contacts.get(current.id)).code}</p>
            <p className="truncate text-sm text-zinc-300">{bookingLabel(current, contacts.get(current.id)).name}</p>
            <p className="truncate text-xs text-zinc-500">{current.serviceSummary}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className={cn("h-full", over > 15 ? "bg-rose-400" : over > 0 ? "bg-amber-400" : "bg-emerald-400")}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </>
        ) : called ? (
          <>
            <Badge tone="amber" pulse>
              <Megaphone className="size-3" /> Called
            </Badge>
            <p className="mt-2 font-mono text-lg font-bold">{bookingLabel(called, contacts.get(called.id)).code}</p>
            <p className="truncate text-sm text-zinc-300">{bookingLabel(called, contacts.get(called.id)).name}</p>
            <p className="truncate text-xs text-zinc-500">{called.serviceSummary}</p>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            {barber.isOnDuty && onBreak ? (
              <>
                <Badge tone="rose">
                  <Coffee className="size-3" /> {onBreak.label === "Break" ? "On break" : onBreak.label}
                </Badge>
                <p className="mt-1 font-mono text-sm text-zinc-300">back {formatClock(onBreak.until, settings.timezone)}</p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">{barber.isOnDuty ? "Chair free" : "Off duty"}</p>
            )}
            {barber.isOnDuty && freeGap !== null && nextEta && (
              <p className="text-xs text-emerald-300">
                <Zap className="mr-1 inline size-3" />
                Free early · {freeGap}m until {nextName || "next booking"} ({formatClock(nextEta.bookedStart, settings.timezone)})
              </p>
            )}
            {barber.isOnDuty && !onBreak && nextBreak && breakSoonMin !== null && breakSoonMin <= 60 && (
              <p className="text-xs text-zinc-400">
                <Coffee className="mr-1 inline size-3" />
                {nextBreak.label} at {formatClock(nextBreak.start, settings.timezone)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2">
        {current && (
          <Button
            variant="success"
            loading={pending === `complete:${current.id}`}
            onClick={() => onTransition(current.kind, current.id, "complete")}
          >
            <CircleCheck className="size-4" /> Mark Complete
          </Button>
        )}
        {current && (
          <div className="grid grid-cols-4 gap-1.5" aria-label="Adjust expected finish">
            {[5, 10, 15].map((m) => (
              <Button
                key={m}
                variant="secondary"
                size="sm"
                className="px-0 font-mono"
                loading={pending === `eta:${current.id}`}
                onClick={() => onAdjust(current, "extend", m)}
                title={`Running over: add ${m} minutes`}
              >
                +{m}
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="px-0 text-xs"
              loading={pending === `eta:${current.id}`}
              onClick={() => onAdjust(current, "finish_in", 5)}
              title="Finishing early: done in about 5 minutes"
            >
              Done ~5
            </Button>
          </div>
        )}
        {!current && !called && barber.isOnDuty && freeGap !== null && nextAppt && !live?.gapFillable && (
          nextAppt.status === "checked_in" ? (
            <Button
              variant="success"
              loading={pending === `seat:${nextAppt.id}`}
              onClick={() => onTransition("appointment", nextAppt.id, "seat")}
            >
              <UserCheck className="size-4" /> Seat {nextName} now
            </Button>
          ) : nextContact && freeGap >= settings.earlyOfferMin ? (
            <div className="space-y-2">
              {/* EZ-011 + EZ-002: hold an earlier slot for the booked customer; they confirm from their pass */}
              <DeskReschedule
                appt={nextAppt}
                contact={nextContact}
                barbers={barbers}
                settings={settings}
                shifts={shifts}
                origin={origin}
                reason="early"
                emphasis
                onChanged={onChanged}
                onMoved={onMoved}
              />
              <a
                href={whatsappLink(
                  nextContact.phone,
                  freeEarlyMessage({
                    shopName: settings.shopName,
                    customerName: nextContact.customerName,
                    barberName: barber.displayName,
                    bookedTime: formatClock(nextAppt.startsAt, settings.timezone),
                    passUrl: `${origin}/pass/${nextContact.accessToken}`,
                  }),
                )}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-xs text-emerald-300 hover:underline"
              >
                or just ask {nextName} to come in now
              </a>
            </div>
          ) : null
        )}
        {called && (
          <>
            <Button
              disabled={Boolean(current)}
              loading={pending === `seat:${called.id}`}
              onClick={() => onTransition(called.kind, called.id, "seat")}
            >
              <UserCheck className="size-4" /> Seat Customer
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={pending === `no_show:${called.id}`}
                onClick={() => onTransition(called.kind, called.id, "no_show")}
              >
                <UserX className="size-4" /> No Show
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={pending === `requeue:${called.id}`}
                onClick={() => onTransition(called.kind, called.id, "requeue")}
              >
                <Undo2 className="size-4" /> Back
              </Button>
              {contacts.get(called.id) ? (
                <a
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-emerald-600/20 text-sm font-semibold text-emerald-300 hover:bg-emerald-600/30"
                  target="_blank"
                  rel="noreferrer"
                  href={whatsappLink(
                    contacts.get(called.id)!.phone,
                    calledNowMessage({
                      shopName: settings.shopName,
                      customerName: contacts.get(called.id)!.customerName,
                      label: bookingLabel(called, contacts.get(called.id)).code,
                      barberName: barber.displayName,
                    }),
                  )}
                >
                  <MessageCircle className="size-4" /> Ping
                </a>
              ) : (
                <span />
              )}
            </div>
          </>
        )}
        {!called && onBreak && barber.isOnDuty && !current ? (
          deskBreak ? (
            <Button variant="secondary" loading={pending === `break:${barber.id}`} onClick={onEndBreak}>
              <Coffee className="size-4" /> Back now
            </Button>
          ) : (
            <Button variant="secondary" disabled>
              <Coffee className="size-4" /> {onBreak.label} until {formatClock(onBreak.until, settings.timezone)}
            </Button>
          )
        ) : (
          !called && (
            <Button
              variant={current ? "secondary" : "primary"}
              disabled={!barber.isOnDuty}
              loading={pending === `call:${barber.id}`}
              onClick={onCallNext}
            >
              <Megaphone className="size-4" /> Call Next
            </Button>
          )
        )}
        {!current && !called && !onBreak && barber.isOnDuty && (
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-1.5" aria-label={`${barber.displayName} take a break`}>
            <span className="pr-1 text-[11px] text-zinc-500">
              <Coffee className="mr-1 inline size-3" />
              Break
            </span>
            {[10, 15, 30].map((m) => (
              <Button
                key={m}
                variant="ghost"
                size="sm"
                className="border border-white/10 px-0 font-mono"
                loading={pending === `break:${barber.id}`}
                onClick={() => onTakeBreak(m)}
                aria-label={`${barber.displayName} takes a ${m}-minute break`}
              >
                {m}m
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function QueueRow({
  ticket,
  eta,
  contact,
  barbers,
  barberById,
  snapshot,
  settings,
  origin,
  pending,
  onSeat,
  onNoShow,
  onNotified,
}: {
  ticket: LiveTicket;
  eta: ReturnType<QueueSnapshot["etas"]["get"]>;
  contact: BookingContact | undefined;
  barbers: Barber[];
  barberById: Map<string, Barber>;
  snapshot: QueueSnapshot;
  settings: ShopSettings;
  origin: string;
  pending: string | null;
  onSeat: (barberId: string) => void;
  onNoShow: () => void;
  onNotified: () => void;
}) {
  const freeChairs = barbers.filter((b) => b.isOnDuty && !snapshot.barbers.get(b.id)?.current);
  const defaultBarber =
    (ticket.preferredBarberId && freeChairs.find((b) => b.id === ticket.preferredBarberId)?.id) ??
    (eta?.barberId && freeChairs.find((b) => b.id === eta.barberId)?.id) ??
    freeChairs[0]?.id ??
    "";
  const [seatChoice, setSeatBarber] = useState<string | null>(null);
  // Fall back to the suggested chair whenever the manual pick is no longer free.
  const seatBarber = seatChoice && freeChairs.some((b) => b.id === seatChoice) ? seatChoice : defaultBarber;

  const dueSoon = eta?.waitMin !== null && eta?.waitMin !== undefined && eta.waitMin <= settings.notifyLeadMin;
  const message = contact
    ? turnSoonMessage({
        shopName: settings.shopName,
        customerName: contact.customerName,
        label: ticket.code,
        minutes: eta?.waitMin ?? settings.notifyLeadMin,
        passUrl: `${origin}/pass/${contact.accessToken}`,
      })
    : "";
  const preferred = ticket.preferredBarberId ? barberById.get(ticket.preferredBarberId) : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      className="flex flex-col gap-3 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="font-mono text-xl font-bold text-zinc-50">{ticket.code}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{contact?.customerName ?? ticket.displayName}</p>
          <p className="truncate text-xs text-zinc-500">{ticket.serviceSummary}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge mono tone={dueSoon ? "amber" : "zinc"}>
              {eta?.waitMin === null || eta?.waitMin === undefined ? "—" : formatWait(eta.waitMin)}
            </Badge>
            {preferred && <Badge tone="sky">wants {preferred.displayName}</Badge>}
            {ticket.checkedInAt && <Badge tone="emerald">Arrived</Badge>}
            {ticket.notifiedAt && <Badge tone="zinc">Notified {formatClock(ticket.notifiedAt, settings.timezone)}</Badge>}
            {ticket.paymentStatus === "paid" && <Badge tone="emerald">Paid {formatMoney(ticket.priceCents, settings.currency)}</Badge>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Chair for ${ticket.code}`}
          value={seatBarber}
          onChange={(e) => setSeatBarber(e.target.value)}
          className="h-9 rounded-lg border border-white/10 bg-zinc-950 px-2 text-sm text-zinc-200"
        >
          {freeChairs.length === 0 && <option value="">No free chair</option>}
          {freeChairs.map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={!seatBarber} loading={pending === `seat:${ticket.id}`} onClick={() => onSeat(seatBarber)}>
          <UserCheck className="size-4" /> Seat
        </Button>
        <Button size="sm" variant="danger" loading={pending === `no_show:${ticket.id}`} onClick={onNoShow}>
          <UserX className="size-4" /> No Show
        </Button>
        {contact && (
          <div className="ml-auto flex gap-2">
            <a
              href={whatsappLink(contact.phone, message)}
              target="_blank"
              rel="noreferrer"
              onClick={onNotified}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
                dueSoon && !ticket.notifiedAt
                  ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                  : "border border-white/10 text-zinc-300 hover:border-white/15",
              )}
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
            <a
              href={smsLink(contact.phone, message)}
              onClick={onNotified}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:border-white/15"
              aria-label="Send SMS"
            >
              <MessageSquare className="size-4" />
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AppointmentRow({
  appt,
  contact,
  barber,
  eta,
  settings,
  origin,
  shifts,
  barbers,
  onChanged,
  onMoved,
  now,
  pending,
  onCheckIn,
  onSeat,
  onNoShow,
}: {
  appt: LiveAppointment;
  contact: BookingContact | undefined;
  barber: Barber | undefined;
  eta: AppointmentEta | undefined;
  settings: ShopSettings;
  origin: string;
  shifts: Shift[];
  barbers: Barber[];
  onChanged: () => void;
  onMoved: (moved: MovedBooking) => void;
  now: Date;
  pending: string | null;
  onCheckIn: (token: string) => void;
  onSeat: () => void;
  onNoShow: () => void;
}) {
  const minutesTo = Math.round((new Date(appt.startsAt).getTime() - now.getTime()) / 60000);
  const late = minutesTo < -5;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="font-mono text-lg font-bold text-zinc-50">{formatClock(appt.startsAt, settings.timezone)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {contact?.customerName ?? appt.displayName}
            <span className="text-zinc-500"> · {barber?.displayName ?? "—"}</span>
          </p>
          <p className="truncate text-xs text-zinc-500">{appt.serviceSummary}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {appt.status === "pending_payment" && <Badge tone="amber">Awaiting payment</Badge>}
            {appt.status === "checked_in" && <Badge tone="emerald">Arrived</Badge>}
            {eta && eta.delayMin >= 5 && (
              <Badge tone={eta.delayMin > 15 ? "rose" : "amber"} mono>
                +{eta.delayMin}m → {formatClock(eta.projectedStart, settings.timezone)}
              </Badge>
            )}
            {late && appt.status !== "checked_in" && <Badge tone="rose">{-minutesTo}m late</Badge>}
            {!late && minutesTo >= 0 && <Badge mono>in {minutesTo}m</Badge>}
            {appt.paymentStatus === "paid" && (
              <Badge tone="emerald">{appt.paymentOption === "deposit" ? "Deposit paid" : "Prepaid"}</Badge>
            )}
          </div>
        </div>
      </div>
      {appt.status !== "pending_payment" && (
        <div className="flex flex-wrap gap-2">
          {appt.status === "confirmed" && contact && (
            <Button size="sm" variant="secondary" loading={pending === `checkin:${contact.accessToken}`} onClick={() => onCheckIn(contact.accessToken)}>
              <ScanLine className="size-4" /> Check in
            </Button>
          )}
          <Button size="sm" loading={pending === `seat:${appt.id}`} onClick={onSeat}>
            <UserCheck className="size-4" /> Seat Customer
          </Button>
          <Button size="sm" variant="danger" loading={pending === `no_show:${appt.id}`} onClick={onNoShow}>
            <UserX className="size-4" /> No Show
          </Button>
          {contact && (
            <a
              href={whatsappLink(contact.phone, `Hi ${contact.customerName.split(/\s+/)[0]}, this is ${settings.shopName} about your ${formatClock(appt.startsAt, settings.timezone)} appointment.`)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm font-semibold text-zinc-300 hover:border-white/15"
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
        </div>
      )}
      {(appt.status === "confirmed" || appt.status === "checked_in") && (
        <div className="flex flex-wrap">
          <DeskReschedule
            appt={appt}
            contact={contact}
            barbers={barbers}
            settings={settings}
            shifts={shifts}
            origin={origin}
            reason="manual"
            onChanged={onChanged}
            onMoved={onMoved}
          />
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------
interface NoFit {
  gapMin: number | null;
  neededMin: number;
  nextLabel: string | null;
  nextStartsAt: string | null;
}

/** desk_call_next returns { kind: null, reason: "no_fit", ... } when no waiting walk-in fits the gap. */
function parseNoFit(data: unknown): NoFit | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.reason !== "no_fit") return null;
  return {
    gapMin: typeof d.gap_min === "number" ? d.gap_min : null,
    neededMin: typeof d.needed_min === "number" ? d.needed_min : 0,
    nextLabel: typeof d.next_label === "string" ? d.next_label : null,
    nextStartsAt: typeof d.next_starts_at === "string" ? d.next_starts_at : null,
  };
}

/** EZ-011: at this delay, the desk pushes "propose new times / another barber". */
const DELAY_RESCHEDULE_MIN = 30;

/** Re-prompt only when the delay grew by this much since the last notice. */
const DELAY_RENOTIFY_STEP_MIN = 10;

function DelayedRow({
  appt,
  eta,
  contact,
  barber,
  settings,
  origin,
  shifts,
  barbers,
  onChanged,
  onMoved,
  pending,
  onNotified,
}: {
  appt: LiveAppointment;
  eta: AppointmentEta;
  contact: BookingContact | undefined;
  barber: Barber | undefined;
  settings: ShopSettings;
  origin: string;
  shifts: Shift[];
  barbers: Barber[];
  onChanged: () => void;
  onMoved: (moved: MovedBooking) => void;
  pending: string | null;
  onNotified: () => void;
}) {
  const needsNotice =
    appt.delayNotifiedMin === null || eta.delayMin - appt.delayNotifiedMin >= DELAY_RENOTIFY_STEP_MIN;
  const expected = formatClock(eta.projectedStart, settings.timezone);
  const message = contact
    ? delayMessage({
        shopName: settings.shopName,
        customerName: contact.customerName,
        barberName: barber?.displayName ?? "Your barber",
        delayMin: eta.delayMin,
        expectedTime: expected,
        passUrl: `${origin}/pass/${contact.accessToken}`,
      })
    : "";
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {contact?.customerName ?? appt.displayName}
          <span className="text-zinc-500"> · {barber?.displayName ?? "—"}</span>
        </p>
        <p className="font-mono text-xs text-zinc-400">
          booked {formatClock(eta.bookedStart, settings.timezone)} → now ~{expected}{" "}
          <span className={eta.delayMin > 15 ? "text-rose-300" : "text-amber-300"}>(+{eta.delayMin}m)</span>
        </p>
        {!needsNotice && appt.delayNotifiedAt && (
          <p className="text-[11px] text-zinc-500">
            Told +{appt.delayNotifiedMin}m at {formatClock(appt.delayNotifiedAt, settings.timezone)}
          </p>
        )}
      </div>
      {contact && (
        <div className="flex gap-2">
          <a
            href={whatsappLink(contact.phone, message)}
            target="_blank"
            rel="noreferrer"
            onClick={onNotified}
            aria-disabled={pending === `delay:${appt.id}`}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
              needsNotice
                ? "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                : "border border-white/10 text-zinc-300 hover:border-white/15",
            )}
          >
            <MessageCircle className="size-4" /> {needsNotice ? "Notify delay" : "Notify again"}
          </a>
          <a
            href={smsLink(contact.phone, message)}
            onClick={onNotified}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:border-white/15"
            aria-label="Send delay SMS"
          >
            <MessageSquare className="size-4" />
          </a>
        </div>
      )}
      <div className="flex w-full flex-wrap items-center gap-2">
        {eta.delayMin >= DELAY_RESCHEDULE_MIN && (
          <span className="text-xs text-rose-300">+{eta.delayMin}m late — offer new times or another barber</span>
        )}
        <DeskReschedule
          appt={appt}
          contact={contact}
          barbers={barbers}
          settings={settings}
          shifts={shifts}
          origin={origin}
          reason="delay"
          emphasis={eta.delayMin >= DELAY_RESCHEDULE_MIN}
          onChanged={onChanged}
          onMoved={onMoved}
        />
      </div>
    </div>
  );
}
