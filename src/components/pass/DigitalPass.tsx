"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BellRing,
  CalendarClock,
  CircleCheck,
  CreditCard,
  DoorClosed,
  MessageCircle,
  Share2,
  Ticket,
  TriangleAlert,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLiveSettings } from "@/hooks/use-live-settings";
import { useLiveShop } from "@/hooks/use-live-shop";
import { useNow } from "@/hooks/use-now";
import { apiErrorMessage, interpolate, type Locale, type Messages } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { overlapsClosure } from "@/lib/closure";
import { cn, formatDuration, formatMoney, formatQueueLine } from "@/lib/format";
import { whatsappLink } from "@/lib/notify";
import { buildQueueSnapshot, chairBlocksForDay, type AppointmentEta } from "@/lib/queue";
import { addDays, formatClock, formatLongDate, formatShortDateTime, localDateString, minutesBetween } from "@/lib/time";
import {
  isShopClosed,
  type ApiError,
  type Barber,
  type LiveAppointment,
  type LiveBooking,
  type LiveTicket,
  type PassData,
  type Shift,
  type ShopSettings,
} from "@/lib/types/domain";
import { PassReschedule } from "../reschedule/PassReschedule";
import { SiteHeader } from "../ui/SiteHeader";
import { Avatar, Badge, Button, type BadgeTone } from "../ui/primitives";

type Stage = { key: string; label: Exclude<keyof Messages["pass"]["progress"], "label"> };
const TICKET_STAGES: Stage[] = [
  { key: "waiting", label: "waiting" },
  { key: "in_chair", label: "inChair" },
  { key: "completed", label: "completed" },
];
const APPOINTMENT_STAGES: Stage[] = [
  { key: "confirmed", label: "booked" },
  { key: "checked_in", label: "checkedIn" },
  { key: "in_chair", label: "inChair" },
  { key: "completed", label: "completed" },
];

function stageIndex(b: LiveBooking): number {
  if (b.kind === "ticket") {
    if (b.status === "completed") return 2;
    if (b.status === "in_chair") return 1;
    return 0;
  }
  if (b.status === "completed") return 3;
  if (b.status === "in_chair") return 2;
  if (b.status === "checked_in" || b.status === "called" || b.checkedInAt) return 1;
  return 0;
}

type StatusKey = keyof Messages["pass"]["status"];
const STATUS_TONE: Record<StatusKey, BadgeTone> = {
  waiting: "amber",
  called: "emerald",
  in_chair: "emerald",
  completed: "zinc",
  no_show: "rose",
  cancelled: "rose",
  pending_payment: "amber",
  confirmed: "emerald",
  checked_in: "sky",
  expired: "rose",
};
const isStatusKey = (s: string): s is StatusKey => Object.prototype.hasOwnProperty.call(STATUS_TONE, s);

const isActive = (b: LiveBooking) =>
  b.kind === "ticket"
    ? b.status === "waiting" || b.status === "called"
    : b.status === "pending_payment" || b.status === "confirmed" || b.status === "checked_in" || b.status === "called";

export function DigitalPass({
  pass,
  settings: initialSettings,
  barbers,
  checkInUrl,
  passUrl,
  paymentParam,
  paymentsEnabled,
  shifts,
  openReschedule,
}: {
  pass: PassData;
  settings: ShopSettings;
  barbers: Barber[];
  checkInUrl: string;
  passUrl: string;
  paymentParam: "success" | "cancelled" | null;
  paymentsEnabled: boolean;
  shifts: Shift[];
  openReschedule: boolean;
}) {
  const { t, locale, format } = useI18n();
  const now = useNow(10_000);
  // EZ-001: closure state arrives live.
  const settings = useLiveSettings(initialSettings, `pass-settings-${pass.token.slice(0, 8)}`);
  const live = useLiveShop({
    initialBarbers: barbers,
    timezone: settings.timezone,
    channelName: `pass-${pass.token.slice(0, 8)}`,
  });

  const booking: LiveBooking = useMemo(() => {
    if (pass.booking.kind === "ticket") {
      return live.tickets.find((t) => t.id === pass.booking.id) ?? pass.booking;
    }
    return live.appointments.find((a) => a.id === pass.booking.id) ?? pass.booking;
  }, [live.tickets, live.appointments, pass.booking]);

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
  const eta = booking.kind === "ticket" ? snapshot.etas.get(booking.id) : undefined;
  const barberById = new Map(live.barbers.map((b) => [b.id, b]));
  const assignedBarber =
    (booking.barberId ? barberById.get(booking.barberId) : undefined) ??
    (eta?.barberId ? barberById.get(eta.barberId) : undefined) ??
    pass.barber ??
    pass.preferredBarber;

  // EZ-011: booked customers see the projected start when their barber runs behind.
  const appointmentEta = booking.kind === "appointment" ? snapshot.appointmentEtas.get(booking.id) : undefined;
  const barberOverMin = assignedBarber ? (snapshot.barbers.get(assignedBarber.id)?.runningOverMin ?? 0) : 0;

  const minutesUntil =
    booking.kind === "ticket"
      ? (eta?.waitMin ?? null)
      : Math.max(0, Math.round(minutesBetween(now, appointmentEta?.projectedStart ?? new Date(booking.startsAt))));
  const turnSoon =
    isActive(booking) &&
    booking.status !== "pending_payment" &&
    (booking.status === "called" || (minutesUntil !== null && minutesUntil <= settings.notifyLeadMin));

  // ---- device notifications -------------------------------------------------
  const browserPermission = useSyncExternalStore(subscribeNoop, readNotificationPermission, () => "default" as const);
  const [requestedPermission, setNotifyState] = useState<NotificationPermission | null>(null);
  const notifyState = requestedPermission ?? browserPermission;
  const alerted = useRef<string | null>(null);
  useEffect(() => {
    if (!turnSoon) return;
    const key = `${booking.status}`;
    if (alerted.current === key) return;
    alerted.current = key;
    navigator.vibrate?.([200, 100, 200]);
    if (notifyState === "granted") {
      const label = booking.kind === "ticket" ? booking.code : t.pass.notification.yourAppointment;
      new Notification(booking.status === "called" ? t.pass.notification.calledTitle : t.pass.notification.soonTitle, {
        body:
          booking.status === "called"
            ? format(t.pass.notification.calledBody, { barber: assignedBarber?.displayName ?? t.pass.turn.yourBarber, label })
            : format(t.pass.notification.soonBody, {
                n: minutesUntil ?? settings.notifyLeadMin,
                label,
                shop: settings.shopName,
              }),
        tag: `easycutz-${booking.id}`,
      });
    }
  }, [turnSoon, booking, notifyState, assignedBarber, minutesUntil, settings, t, format]);

  // ---- actions --------------------------------------------------------------
  const [busy, setBusy] = useState<"cancel" | "pay" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [banner, setBanner] = useState(paymentParam);

  async function cancel() {
    setBusy("cancel");
    try {
      const res = await fetch(`/api/bookings/${pass.token}/cancel`, { method: "POST" });
      if (!res.ok) setMessage(apiErrorMessage(t, (await res.json()) as ApiError));
      else await live.refresh();
    } catch {
      setMessage(t.errors.network);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  }

  async function pay() {
    setBusy("pay");
    try {
      const res = await fetch(`/api/bookings/${pass.token}/pay`, { method: "POST" });
      const json = (await res.json()) as { checkoutUrl?: string } & Partial<ApiError>;
      if (res.ok && json.checkoutUrl) window.location.assign(json.checkoutUrl);
      else setMessage(res.ok ? t.pass.payment.couldNotOpen : apiErrorMessage(t, json, t.pass.payment.couldNotOpen));
    } catch {
      setMessage(t.errors.network);
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    const data = { title: format(t.pass.actions.shareTitle, { shop: settings.shopName }), url: passUrl };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(passUrl);
        setMessage(t.pass.actions.linkCopied);
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  const status = isStatusKey(booking.status)
    ? { label: t.pass.status[booking.status], tone: STATUS_TONE[booking.status] }
    : { label: booking.status, tone: "zinc" as BadgeTone };
  const stages = booking.kind === "ticket" ? TICKET_STAGES : APPOINTMENT_STAGES;
  const current = stageIndex(booking);
  const ended = !isActive(booking) && booking.status !== "in_chair";
  const needsPayment =
    paymentsEnabled &&
    booking.paymentStatus !== "paid" &&
    ((booking.kind === "appointment" && booking.status === "pending_payment") ||
      (booking.kind === "ticket" && isActive(booking) && booking.paymentOption !== "cash_on_site"));

  const notice = closureNotice({ booking, pass, settings, now, t, locale });

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader shopName={settings.shopName} status={live.status} />

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-16 pt-6">
        <AnimatePresence>
          {banner && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "mb-4 flex items-start gap-3 rounded-2xl border p-4 text-sm",
                banner === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-100",
              )}
            >
              {banner === "success" ? <CircleCheck className="size-5 shrink-0" /> : <TriangleAlert className="size-5 shrink-0" />}
              <p className="flex-1">
                {banner === "success"
                  ? booking.paymentStatus === "paid"
                    ? t.pass.payment.received
                    : t.pass.payment.submitted
                  : t.pass.payment.notCompleted}
              </p>
              <button type="button" aria-label={t.common.actions.dismiss} onClick={() => setBanner(null)}>
                <X className="size-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {notice && (
          <div role="status" className="mb-4 flex gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-100">
            <DoorClosed className="size-6 shrink-0 text-rose-300" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{notice.title}</p>
              {notice.message && <p className="mt-1 text-sm text-rose-100/80">{notice.message}</p>}
              <p className="mt-1 text-sm text-rose-200/80">{notice.detail}</p>
              {notice.bookAgain && (
                <Link
                  href="/"
                  className="mt-3 inline-flex h-9 items-center rounded-lg bg-amber-500 px-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
                >
                  {t.pass.closure.bookOtherDay}
                </Link>
              )}
            </div>
          </div>
        )}

        <AnimatePresence>
          {!notice && turnSoon && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-500/50 bg-amber-500 p-4 text-zinc-950 shadow-[0_12px_40px_-12px_rgb(245_158_11/0.8)]"
            >
              <BellRing className="size-6 shrink-0 animate-bounce" />
              <div>
                <p className="font-bold">
                  {booking.status === "called" ? t.pass.turn.calledTitle : t.pass.turn.soonTitle}
                </p>
                <p className="text-sm text-zinc-900/80">
                  {booking.status === "called"
                    ? format(t.pass.turn.barberReady, { barber: assignedBarber?.displayName ?? t.pass.turn.yourBarber })
                    : minutesUntil !== null && minutesUntil > 1
                      ? booking.checkedInAt
                        ? format(t.pass.turn.checkedInSoon, { n: minutesUntil })
                        : format(t.pass.turn.soon, { n: minutesUntil })
                      : t.pass.turn.chairOpening}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The pass */}
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-2xl"
        >
          <div className="p-6">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500">
                {booking.kind === "ticket" ? <Ticket className="size-4" /> : <CalendarClock className="size-4" />}
                {booking.kind === "ticket" ? t.pass.kind.ticket : t.pass.kind.appointment}
              </p>
              <Badge tone={status.tone} pulse={isActive(booking) || booking.status === "in_chair"}>
                {status.label}
              </Badge>
            </div>

            {booking.kind === "ticket" ? (
              <TicketHeadline
                ticket={booking}
                etaMin={eta?.waitMin ?? null}
                ahead={eta?.aheadCount ?? null}
                timezone={settings.timezone}
                now={now}
                barberOverMin={barberOverMin}
                t={t}
                locale={locale}
              />
            ) : (
              <AppointmentHeadline appt={booking} timezone={settings.timezone} eta={appointmentEta} t={t} locale={locale} />
            )}

            {/* Progress */}
            <ol className="mt-6 flex items-center gap-1" aria-label={t.pass.progress.label}>
              {stages.map((s, i) => {
                const reached = !["cancelled", "no_show", "expired"].includes(booking.status) && i <= current;
                return (
                  <li key={s.key} className="flex flex-1 flex-col gap-1.5">
                    <motion.span
                      className={cn("h-1.5 rounded-full", reached ? "bg-amber-500" : "bg-white/10")}
                      initial={false}
                      animate={{ opacity: reached ? 1 : 0.6 }}
                    />
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wide", reached ? "text-zinc-200" : "text-zinc-600")}>
                      {t.pass.progress[s.label]}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Perforation */}
          <div className="relative flex items-center" aria-hidden>
            <span className="absolute -left-3 size-6 rounded-full bg-zinc-950" />
            <span className="mx-5 w-full border-t-2 border-dashed border-white/10" />
            <span className="absolute -right-3 size-6 rounded-full bg-zinc-950" />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-6">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">{t.pass.details.name}</p>
                <p className="font-semibold text-zinc-100">{pass.customerName}</p>
                <p className="font-mono text-xs text-zinc-500">{pass.phoneMasked}</p>
              </div>
              <div className="flex items-center gap-2">
                {assignedBarber ? (
                  <>
                    <Avatar name={assignedBarber.displayName} src={assignedBarber.avatarUrl} size={32} />
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{t.pass.details.barber}</p>
                      <p className="font-semibold text-zinc-100">
                        {assignedBarber.displayName}
                        {booking.kind === "ticket" && !booking.barberId && (
                          <span className="font-normal text-zinc-500"> {t.pass.details.likely}</span>
                        )}
                      </p>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-zinc-500">{t.pass.details.barber}</p>
                    <p className="font-semibold text-zinc-100">{t.pass.details.firstAvailable}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-2.5">
              <QRCodeSVG value={checkInUrl} size={112} level="M" marginSize={0} bgColor="#ffffff" fgColor="#09090b" />
            </div>
            <p className="col-span-2 -mt-2 text-right text-[11px] text-zinc-500">{t.pass.details.scanToCheckIn}</p>
          </div>

          <div className="border-t border-white/10 glass-inset p-6 text-sm">
            <p className="text-zinc-300">{booking.serviceSummary}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-500">{formatDuration(booking.durationMin, locale)}</span>
              <span className="font-mono font-bold tabular text-amber-400">
                {formatMoney(booking.priceCents, settings.currency)}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
              <CreditCard className="size-3.5" />
              {booking.paymentStatus === "paid"
                ? booking.paymentOption === "deposit"
                  ? t.pass.payment.depositPaid
                  : t.pass.payment.paidInFull
                : booking.paymentOption === "cash_on_site"
                  ? t.pass.payment.payAtShop
                  : booking.paymentStatus === "failed"
                    ? t.pass.payment.onlineFailed
                    : t.pass.payment.onlinePending}
            </p>
          </div>
        </motion.article>

        {/* EZ-002: held offers / pick a new time */}
        {booking.kind === "appointment" && pass.reschedule && (booking.status === "confirmed" || booking.status === "checked_in") && (
          <PassReschedule
            token={pass.token}
            appt={booking}
            data={pass.reschedule}
            settings={settings}
            shifts={shifts}
            barbers={live.barbers}
            autoOpen={openReschedule}
          />
        )}

        {/* Actions */}
        <div className="mt-5 space-y-3">
          {needsPayment && (
            <Button size="lg" className="w-full" loading={busy === "pay"} onClick={() => void pay()}>
              <CreditCard className="size-5" /> {t.pass.payment.complete}
            </Button>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => void share()}>
              <Share2 className="size-4" /> {t.pass.actions.share}
            </Button>
            {notifyState === "default" ? (
              <Button
                variant="secondary"
                onClick={async () => setNotifyState(await Notification.requestPermission())}
              >
                <BellRing className="size-4" /> {t.pass.actions.alertMe}
              </Button>
            ) : settings.shopPhone ? (
              <a
                href={whatsappLink(
                  settings.shopPhone,
                  booking.kind === "ticket"
                    ? format(t.pass.actions.whatsappTicket, { shop: settings.shopName, code: booking.code })
                    : format(t.pass.actions.whatsappAppointment, { shop: settings.shopName }),
                )}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] text-sm font-semibold text-zinc-100 hover:border-white/15"
              >
                <MessageCircle className="size-4" /> {t.pass.actions.whatsappShop}
              </a>
            ) : (
              <span />
            )}
          </div>

          {isActive(booking) && (
            <div className="pt-2 text-center">
              {confirmCancel ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm text-zinc-400">
                    {booking.kind === "ticket" ? t.pass.cancel.confirmTicket : t.pass.cancel.confirmAppointment}
                  </span>
                  <Button variant="danger" size="sm" loading={busy === "cancel"} onClick={() => void cancel()}>
                    {booking.kind === "ticket" ? t.pass.cancel.yesLeave : t.pass.cancel.yesCancel}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
                    {t.pass.cancel.keep}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                >
                  {booking.kind === "ticket" ? t.pass.cancel.leaveQueue : t.pass.cancel.cancelBooking}
                </button>
              )}
            </div>
          )}

          {ended && (
            <p className="text-center text-sm text-zinc-500">
              {booking.status === "completed" ? t.pass.ended.thanks : t.pass.ended.inactive}{" "}
              <Link href="/" className="text-amber-400 hover:underline">
                {t.pass.actions.bookAgain}
              </Link>
            </p>
          )}

          {message && <p className="text-center text-sm text-amber-200">{message}</p>}
        </div>
      </main>
    </div>
  );
}

const subscribeNoop = () => () => undefined;
function readNotificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function TicketHeadline({
  ticket,
  etaMin,
  ahead,
  timezone,
  now,
  barberOverMin,
  t,
  locale,
}: {
  ticket: LiveTicket;
  etaMin: number | null;
  ahead: number | null;
  timezone: string;
  now: Date;
  barberOverMin: number;
  t: Messages;
  locale: Locale;
}) {
  return (
    <div className="mt-5">
      <p className="text-xs text-zinc-500">{t.pass.ticket.label}</p>
      <motion.p
        key={ticket.code}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="font-mono text-6xl font-extrabold tracking-tight text-zinc-50"
      >
        #{ticket.code}
      </motion.p>
      {ticket.status === "waiting" && (
        <p className="mt-2 font-mono text-sm text-amber-400">
          {etaMin === null ? t.pass.ticket.waitingForChair : formatQueueLine(etaMin, ahead ?? 0, locale)}
          {etaMin !== null && etaMin > 1 && (
            <span className="text-zinc-500">
              {" · "}
              {interpolate(t.pass.ticket.around, {
                time: formatClock(new Date(now.getTime() + etaMin * 60000), timezone, locale),
              })}
            </span>
          )}
        </p>
      )}
      {ticket.status === "waiting" && barberOverMin > 0 && (
        <p className="mt-1 text-xs text-amber-200/80">{t.pass.ticket.runningBehind}</p>
      )}
      {ticket.status === "in_chair" && <p className="mt-2 text-sm text-emerald-300">{t.pass.ticket.enjoy}</p>}
    </div>
  );
}

function AppointmentHeadline({
  appt,
  timezone,
  eta,
  t,
  locale,
}: {
  appt: LiveAppointment;
  timezone: string;
  eta: AppointmentEta | undefined;
  t: Messages;
  locale: Locale;
}) {
  const delayed = eta && eta.delayMin >= 5 && (appt.status === "confirmed" || appt.status === "checked_in");
  return (
    <div className="mt-5">
      <p className="text-xs text-zinc-500">{formatLongDate(appt.startsAt, timezone, locale)}</p>
      <p className="font-mono text-5xl font-extrabold tracking-tight text-zinc-50">{formatClock(appt.startsAt, timezone, locale)}</p>
      <p className="mt-1 font-mono text-sm text-zinc-500">
        {interpolate(t.pass.appointment.until, { time: formatClock(appt.endsAt, timezone, locale) })}
      </p>
      {delayed && eta && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          {interpolate(t.pass.appointment.runningLateBefore, { n: eta.delayMin })}{" "}
          <span className="font-mono font-semibold">{formatClock(eta.projectedStart, timezone, locale)}</span>
          {t.pass.appointment.runningLateAfter}
        </motion.p>
      )}
      {appt.status === "pending_payment" && appt.holdExpiresAt && (
        <p className="mt-2 text-sm text-amber-300">
          {interpolate(t.pass.appointment.slotHeld, { time: formatClock(appt.holdExpiresAt, timezone, locale) })}
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------
// EZ-001: what to tell the customer about an emergency closure

/** "today at 6:00 pm", "tomorrow at 10:00 am" or "Thu 8 Oct · 10:00 am", in the active language. */
function formatReopenLocalized(until: string, timezone: string, now: Date, t: Messages, locale: Locale): string {
  const d = new Date(until);
  const today = localDateString(now, timezone);
  const day = localDateString(d, timezone);
  const time = formatClock(d, timezone, locale);
  if (day === today) return interpolate(t.pass.closure.reopenToday, { time });
  if (day === addDays(today, 1)) return interpolate(t.pass.closure.reopenTomorrow, { time });
  return formatShortDateTime(d, timezone, locale);
}

function closureNotice({
  booking,
  pass,
  settings,
  now,
  t,
  locale,
}: {
  booking: LiveBooking;
  pass: PassData;
  settings: ShopSettings;
  now: Date;
  t: Messages;
  locale: Locale;
}): { title: string; message: string | null; detail: string; bookAgain: boolean } | null {
  const copy = t.pass.closure;
  const closure = pass.closure;
  const closedNow = isShopClosed(settings, now);
  const reopens = settings.closedUntil ? formatReopenLocalized(settings.closedUntil, settings.timezone, now, t, locale) : null;
  const paid = booking.paymentStatus === "paid";

  if (booking.kind === "ticket" && booking.status === "cancelled" && booking.cancelReason === "shop_closed") {
    return {
      title: copy.ticketCancelledTitle,
      message: closure?.message ?? settings.closureMessage,
      detail: (paid ? copy.onlineRefund : "") + copy.welcomeBack,
      bookAgain: true,
    };
  }
  if (booking.kind === "appointment" && closure?.action === "hold_released" && booking.status === "expired") {
    return {
      title: copy.holdReleasedTitle,
      message: closure.message,
      detail: (paid ? copy.paymentRefund : "") + copy.bookAnother,
      bookAgain: true,
    };
  }
  const live = booking.status === "confirmed" || booking.status === "checked_in" || booking.status === "called";
  if (booking.kind === "appointment" && live && closure && overlapsClosure(booking, closure)) {
    return {
      title: copy.atBookingTimeTitle,
      message: closure.message,
      detail: copy.keptDetail,
      bookAgain: false,
    };
  }
  if (closedNow && reopens && (booking.kind === "ticket" ? booking.status === "waiting" : live)) {
    const unaffected = booking.kind === "appointment" &&
      settings.closedUntil !== null &&
      new Date(booking.startsAt).getTime() >= new Date(settings.closedUntil).getTime();
    return {
      title: interpolate(copy.reopeningTitle, { when: reopens }),
      message: settings.closureMessage,
      detail: unaffected
        ? interpolate(copy.unaffected, {
            date: formatLongDate(booking.startsAt, settings.timezone, locale),
            time: formatClock(booking.startsAt, settings.timezone, locale),
          })
        : copy.sorry,
      bookAgain: false,
    };
  }
  return null;
}
