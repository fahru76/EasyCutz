"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Armchair,
  CalendarClock,
  CircleCheck,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquare,
  ScanLine,
  Undo2,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveShop } from "@/hooks/use-live-shop";
import { useNow } from "@/hooks/use-now";
import { cn, formatMoney, formatWait } from "@/lib/format";
import { calledNowMessage, smsLink, turnSoonMessage, whatsappLink } from "@/lib/notify";
import { buildQueueSnapshot, type QueueSnapshot } from "@/lib/queue";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { formatClock } from "@/lib/time";
import {
  mapContact,
  type Barber,
  type BookingContact,
  type BookingKind,
  type LiveAppointment,
  type LiveBooking,
  type LiveTicket,
  type ShopSettings,
} from "@/lib/types/domain";
import { SiteHeader } from "../ui/SiteHeader";
import { Avatar, Badge, Button, Card, Switch, type BadgeTone } from "../ui/primitives";

type Action = "seat" | "complete" | "no_show" | "requeue";

const APPT_LIVE = new Set(["pending_payment", "confirmed", "checked_in", "called"]);

export function DeskBoard({
  settings,
  initialBarbers,
  staffName,
  origin,
}: {
  settings: ShopSettings;
  initialBarbers: Barber[];
  staffName: string;
  origin: string;
}) {
  const router = useRouter();
  const now = useNow(10_000);
  const live = useLiveShop({ initialBarbers, timezone: settings.timezone, channelName: "desk-live" });
  const snapshot = useMemo(
    () => buildQueueSnapshot({ now, barbers: live.barbers, tickets: live.tickets, appointments: live.appointments }),
    [now, live.barbers, live.tickets, live.appointments],
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
      return res;
    });
  const transition = (kind: BookingKind, id: string, action: Action, barberId?: string) =>
    run(`${action}:${id}`, async () =>
      db.rpc("desk_transition", { p_kind: kind, p_id: id, p_action: action, p_barber_id: barberId ?? null }),
    );
  const checkIn = (token: string) => run(`checkin:${token}`, async () => db.rpc("desk_check_in", { p_token: token }), "Checked in");
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

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        wide
        shopName={settings.shopName}
        status={live.status}
        right={
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-zinc-400 sm:inline">{staffName}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-100"
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
              pending={pending}
              onCallNext={() => void callNext(barber)}
              onTransition={(kind, id, action) => void transition(kind, id, action, barber.id)}
              onDuty={(on) => void setDuty(barber, on)}
            />
          ))}
        </section>

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
                  settings={settings}
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
                ? "border-emerald-500/40 bg-zinc-950/95 text-emerald-200"
                : "border-rose-500/40 bg-zinc-950/95 text-rose-200",
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
    <div className="min-w-[72px] rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 text-center">
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
  pending,
  onCallNext,
  onTransition,
  onDuty,
}: {
  barber: Barber;
  snapshot: QueueSnapshot;
  contacts: Map<string, BookingContact>;
  settings: ShopSettings;
  now: Date;
  pending: string | null;
  onCallNext: () => void;
  onTransition: (kind: BookingKind, id: string, action: Action) => void;
  onDuty: (on: boolean) => void;
}) {
  const live = snapshot.barbers.get(barber.id);
  const current = live?.current ?? null;
  const called = live?.called ?? null;
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

      <div className="mt-4 min-h-[112px] flex-1 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
        {current ? (
          <>
            <div className="flex items-center justify-between">
              <Badge tone="emerald" pulse>
                <Armchair className="size-3" /> In chair
              </Badge>
              <span className="font-mono text-xs text-zinc-400">{live?.minutesLeft ?? 0}m left</span>
            </div>
            <p className="mt-2 font-mono text-lg font-bold">{bookingLabel(current, contacts.get(current.id)).code}</p>
            <p className="truncate text-sm text-zinc-300">{bookingLabel(current, contacts.get(current.id)).name}</p>
            <p className="truncate text-xs text-zinc-500">{current.serviceSummary}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
              <motion.div className="h-full bg-emerald-400" initial={{ width: 0 }} animate={{ width: `${Math.round(progress * 100)}%` }} />
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
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-zinc-500">{barber.isOnDuty ? "Chair free" : "Off duty"}</p>
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
        {!called && (
          <Button
            variant={current ? "secondary" : "primary"}
            disabled={!barber.isOnDuty}
            loading={pending === `call:${barber.id}`}
            onClick={onCallNext}
          >
            <Megaphone className="size-4" /> Call Next
          </Button>
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
          className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
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
                  : "border border-zinc-800 text-zinc-300 hover:border-zinc-700",
              )}
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
            <a
              href={smsLink(contact.phone, message)}
              onClick={onNotified}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-300 hover:border-zinc-700"
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
  settings,
  now,
  pending,
  onCheckIn,
  onSeat,
  onNoShow,
}: {
  appt: LiveAppointment;
  contact: BookingContact | undefined;
  barber: Barber | undefined;
  settings: ShopSettings;
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
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 px-3 text-sm font-semibold text-zinc-300 hover:border-zinc-700"
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  );
}
