"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CalendarClock,
  CircleCheck,
  DoorClosed,
  DoorOpen,
  MessageCircle,
  MessageSquare,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { defaultClosureMessage, formatReopen, reopenOptions, type ReopenOption } from "@/lib/closure";
import { cn } from "@/lib/format";
import { closureAppointmentMessage, closureTicketMessage, rescheduledMessage, smsLink, whatsappLink } from "@/lib/notify";
import type { CloseShopResult, ClosureImpactView, ClosureSummary } from "@/lib/server/closure";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { formatShortDateTime, localDateString, localToUtc } from "@/lib/time";
import {
  CLOSURE_REASONS,
  isShopClosed,
  type ApiError,
  type Barber,
  type ClosureReason,
  type Shift,
  type ShopSettings,
} from "@/lib/types/domain";
import { Badge, Button, Card, inputClass } from "../ui/primitives";

const POLL_MS = 30_000;
const LIVE_APPT = new Set(["confirmed", "checked_in", "called"]);

/**
 * EZ-001: "Close shop now" on the Quick-Desk, the closed banner with Reopen,
 * and the list of affected customers with tap-to-send messages.
 */
export function ClosurePanel({
  settings,
  shifts,
  barbers,
  origin,
  waitingCount,
  onChanged,
}: {
  settings: ShopSettings;
  shifts: Shift[];
  barbers: Barber[];
  origin: string;
  waitingCount: number;
  onChanged: () => void;
}) {
  const now = useNow(15_000);
  const [summary, setSummary] = useState<ClosureSummary | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<"close" | "change" | null>(null);
  const [result, setResult] = useState<CloseShopResult | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/desk/closure", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) throw new Error((body as ApiError).message ?? "Couldn't load closure");
        setSummary(body as ClosureSummary);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : "Couldn't load closure");
      });
    return () => controller.abort();
  }, [reloadKey, settings.closedUntil]);

  const hasClosure = Boolean(summary?.closure);
  useEffect(() => {
    if (!hasClosure) return;
    const id = window.setInterval(() => setReloadKey((k) => k + 1), POLL_MS);
    return () => window.clearInterval(id);
  }, [hasClosure]);

  const reload = () => setReloadKey((k) => k + 1);
  const closure = summary?.closure ?? null;
  // The server summary is refreshed after every desk action, so it wins over the
  // realtime settings row (which may lag); before it loads, fall back to settings.
  const activeClosure =
    closure && !closure.reopenedAt && new Date(closure.startsAt) <= now && new Date(closure.endsAt) > now ? closure : null;
  const closedNow = summary ? activeClosure !== null : isShopClosed(settings, now);
  const closedUntil = activeClosure?.endsAt ?? settings.closedUntil;
  const closureMessage = activeClosure?.message ?? settings.closureMessage;
  const showFollowUp = closure !== null && (closedNow || dismissed !== closure.id);

  async function reopen() {
    setBusy("reopen");
    setError(null);
    try {
      const res = await fetch("/api/desk/closure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      if (!res.ok) setError(((await res.json()) as ApiError).message);
      setConfirmReopen(false);
      setResult(null);
      onChanged();
      reload();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Shop closure" className="space-y-3">
      {!closedNow && form === null && (
        <div className="flex justify-end">
          <Button variant="danger" size="sm" onClick={() => setForm("close")}>
            <DoorClosed className="size-4" /> Close shop (emergency)
          </Button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {form && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CloseShopForm
              mode={form}
              settings={
                activeClosure
                  ? { ...settings, closedUntil: activeClosure.endsAt, closureMessage: activeClosure.message, closureReason: activeClosure.reason }
                  : settings
              }
              shifts={shifts}
              now={now}
              waitingCount={waitingCount}
              onCancel={() => setForm(null)}
              onDone={(r) => {
                setForm(null);
                setResult(r);
                setDismissed(null);
                onChanged();
                reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {closedNow && closedUntil && (
        <div role="status" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <DoorClosed className="mt-0.5 size-6 shrink-0 text-rose-300" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-rose-100">
                Shop closed · reopens {formatReopen(closedUntil, settings.timezone, now)}
              </p>
              {closureMessage && <p className="mt-1 text-sm text-rose-100/80">“{closureMessage}”</p>}
              <p className="mt-1 text-xs text-rose-200/70">Walk-in queue paused · online booking blocked until then.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setForm("change")}>
                <CalendarClock className="size-4" /> Change time / message
              </Button>
              {confirmReopen ? (
                <Button variant="success" size="sm" loading={busy === "reopen"} onClick={() => void reopen()}>
                  <DoorOpen className="size-4" /> Yes, reopen now
                </Button>
              ) : (
                <Button variant="success" size="sm" onClick={() => setConfirmReopen(true)}>
                  <DoorOpen className="size-4" /> Reopen now
                </Button>
              )}
            </div>
          </div>
          {result && (
            <p className="mt-3 rounded-xl glass-inset p-3 text-sm text-zinc-200">
              {result.ticketsCancelled} walk-in ticket{result.ticketsCancelled === 1 ? "" : "s"} cancelled ·{" "}
              {result.appointments} booking{result.appointments === 1 ? "" : "s"} affected
              {result.appointments > 0 && ` (${result.appointmentsWithOffers} with new times held)`}
              {result.holdsReleased > 0 &&
                ` · ${result.holdsReleased} unpaid hold${result.holdsReleased === 1 ? "" : "s"} released`}
            </p>
          )}
        </div>
      )}

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</p>}
      {loadError && hasClosure && (
        <p className="text-xs text-rose-300">Couldn&apos;t refresh affected customers: {loadError}</p>
      )}

      {showFollowUp && summary && (
        <AffectedList
          summary={summary}
          settings={settings}
          barbers={barbers}
          origin={origin}
          now={now}
          active={closedNow}
          onDismiss={closedNow || !closure ? null : () => setDismissed(closure.id)}
          onChanged={() => {
            onChanged();
            reload();
          }}
        />
      )}
    </section>
  );
}

// -------------------------------------------------------------------------------------
type UntilChoice = ReopenOption["id"] | "custom";

function CloseShopForm({
  mode,
  settings,
  shifts,
  now,
  waitingCount,
  onCancel,
  onDone,
}: {
  mode: "close" | "change";
  settings: ShopSettings;
  shifts: Shift[];
  now: Date;
  waitingCount: number;
  onCancel: () => void;
  onDone: (result: CloseShopResult) => void;
}) {
  const options = useMemo(
    () => reopenOptions(now, settings.timezone, shifts, settings.bookingHorizonDays),
    [now, settings.timezone, settings.bookingHorizonDays, shifts],
  );
  const [reason, setReason] = useState<ClosureReason>((mode === "change" && settings.closureReason) || "power");
  const [choice, setChoice] = useState<UntilChoice>(mode === "change" ? "custom" : (options.at(-1)?.id ?? "custom"));
  const initialCustom = mode === "change" && settings.closedUntil ? new Date(settings.closedUntil) : null;
  const [customDate, setCustomDate] = useState(() =>
    localDateString(initialCustom ?? now, settings.timezone),
  );
  const [customTime, setCustomTime] = useState(() =>
    initialCustom
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: settings.timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(initialCustom)
      : "18:00",
  );
  const [messageDraft, setMessageDraft] = useState<string | null>(
    mode === "change" ? (settings.closureMessage ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const until: Date | null = (() => {
    if (choice !== "custom") return options.find((o) => o.id === choice)?.until ?? null;
    const [h, m] = customTime.split(":").map(Number);
    if (!customDate || h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
    return localToUtc(customDate, h * 60 + m, settings.timezone);
  })();
  const tooSoon = until !== null && until.getTime() < now.getTime() + 5 * 60_000;
  const reopenLabel = until ? formatReopen(until, settings.timezone, now) : "soon";
  const message = messageDraft ?? defaultClosureMessage(reason, reopenLabel);

  const choices: Array<{ id: UntilChoice; label: string }> = [
    ...options.map((o) => ({ id: o.id, label: o.id === "1h" || o.id === "2h" ? `In ${o.label}` : o.label })),
    { id: "custom", label: "Pick date & time" },
  ];

  async function submit() {
    if (!until || tooSoon) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/desk/closure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", until: until.toISOString(), reason, message: message.trim() }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        setError((body as ApiError).message ?? "Couldn't close the shop.");
        return;
      }
      onDone(body as CloseShopResult);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 border-rose-500/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-rose-300">
            {mode === "close" ? "Emergency closure" : "Update closure"}
          </p>
          <h2 className="mt-1 text-lg font-bold">
            {mode === "close" ? "Close the shop now" : "Change reopen time or message"}
          </h2>
        </div>
        <button type="button" aria-label="Cancel" onClick={onCancel} className="text-zinc-500 hover:text-zinc-200">
          <X className="size-5" />
        </button>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Reason</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
          {CLOSURE_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={reason === r.id}
              onClick={() => setReason(r.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-semibold",
                reason === r.id
                  ? "border-rose-400 bg-rose-500/20 text-rose-100"
                  : "border-white/10 text-zinc-300 hover:border-white/15",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Reopen</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reopen">
          {choices.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={choice === o.id}
              onClick={() => setChoice(o.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-semibold",
                choice === o.id
                  ? "border-amber-500 bg-amber-500 text-zinc-950"
                  : "border-white/10 text-zinc-300 hover:border-white/15",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {choice === "custom" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Reopen date"
              className={inputClass}
              value={customDate}
              min={localDateString(now, settings.timezone)}
              onChange={(e) => setCustomDate(e.target.value)}
            />
            <input
              type="time"
              aria-label="Reopen time"
              className={inputClass}
              value={customTime}
              step={300}
              onChange={(e) => setCustomTime(e.target.value)}
            />
          </div>
        )}
        <p className={cn("mt-2 text-sm", tooSoon ? "text-rose-300" : "text-zinc-400")}>
          {until
            ? tooSoon
              ? "Pick a reopen time at least 5 minutes from now."
              : `Closed until ${formatShortDateTime(until, settings.timezone)}`
            : "Pick a reopen time."}
        </p>
      </fieldset>

      <div>
        <label
          htmlFor="closure-message"
          className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          Message to customers
          <span className="font-mono normal-case tracking-normal text-zinc-500">{message.length}/280</span>
        </label>
        <textarea
          id="closure-message"
          rows={3}
          maxLength={280}
          value={message}
          onChange={(e) => setMessageDraft(e.target.value)}
          className={cn(inputClass, "h-auto py-3")}
        />
        {messageDraft !== null && (
          <button type="button" className="mt-1 text-xs text-amber-400 hover:underline" onClick={() => setMessageDraft(null)}>
            Use suggested message
          </button>
        )}
      </div>

      {mode === "close" && (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-100">
          <TriangleAlert className="size-5 shrink-0 text-amber-400" />
          <p>
            {waitingCount > 0
              ? `${waitingCount} waiting walk-in${waitingCount === 1 ? "" : "s"} will be cancelled. `
              : "No walk-ins are waiting. "}
            Booked customers inside the closure keep their booking until they pick one of the new times we hold for
            them. Customers already in a chair aren&apos;t affected.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={mode === "close" ? "danger" : "primary"}
          loading={busy}
          disabled={!until || tooSoon || message.trim().length === 0}
          onClick={() => void submit()}
        >
          <DoorClosed className="size-4" /> {mode === "close" ? "Close shop now" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------------------------------
function AffectedList({
  summary,
  settings,
  barbers,
  origin,
  now,
  active,
  onDismiss,
  onChanged,
}: {
  summary: ClosureSummary;
  settings: ShopSettings;
  barbers: Barber[];
  origin: string;
  now: Date;
  active: boolean;
  onDismiss: (() => void) | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closure = summary.closure;
  if (!closure) return null;

  const barberName = (id: string | null) => barbers.find((b) => b.id === id)?.displayName ?? "your barber";
  const reopenLabel = formatReopen(closure.endsAt, settings.timezone, now);
  const passUrl = (i: ClosureImpactView) => `${origin}/pass/${i.passToken}`;

  const messageFor = (i: ClosureImpactView): string | null => {
    if (i.action === "ticket_cancelled") {
      return closureTicketMessage({
        shopName: settings.shopName,
        customerName: i.customerName,
        code: i.code ?? "",
        shopMessage: closure.message,
        reopensAt: reopenLabel,
        bookUrl: `${origin}/`,
        refund: i.needsRefund,
      });
    }
    if (i.action === "appointment_affected" && i.startsAt && LIVE_APPT.has(i.status) && i.stillInWindow) {
      const earliestExpiry = i.offers.reduce<string | null>(
        (min, o) => (min === null || o.expiresAt < min ? o.expiresAt : min),
        null,
      );
      return closureAppointmentMessage({
        shopName: settings.shopName,
        customerName: i.customerName,
        bookedTime: formatShortDateTime(i.startsAt, settings.timezone),
        shopMessage: closure.message,
        options: i.offers.map((o) => `${formatShortDateTime(o.startsAt, settings.timezone)} · ${barberName(o.barberId)}`),
        holdUntil: earliestExpiry ? formatShortDateTime(earliestExpiry, settings.timezone) : null,
        passUrl: passUrl(i),
      });
    }
    return null;
  };

  const toNotify = summary.impacts.filter((i) => messageFor(i) !== null);
  const pending = toNotify.filter((i) => !i.notifiedAt);
  const next = pending[0];
  const nextMessage = next ? messageFor(next) : null;

  async function markNotified(impactId: string) {
    const { error: e } = await getBrowserSupabase().rpc("desk_mark_closure_notified", { p_impact_id: impactId });
    if (e) setError(e.message);
    onChanged();
  }

  async function propose(i: ClosureImpactView) {
    setBusy(`propose:${i.id}`);
    setError(null);
    try {
      const res = await fetch("/api/desk/reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId: i.bookingId, reason: "closure", limit: 3 }),
      });
      const body = (await res.json()) as { offers?: unknown[] } & Partial<ApiError>;
      if (!res.ok) setError(body.message ?? "Couldn't propose times.");
      else if (!body.offers?.length) setError(`No free times found for ${i.customerName} in the next week.`);
      onChanged();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelBooking(i: ClosureImpactView) {
    setBusy(`cancel:${i.id}`);
    setError(null);
    const { error: e } = await getBrowserSupabase().rpc("desk_cancel_affected", { p_impact_id: i.id });
    if (e) setError(e.message === "invalid_transition" ? "That booking can't be cancelled any more." : e.message);
    setBusy(null);
    onChanged();
  }

  return (
    <Card className={cn("overflow-hidden", active ? "border-rose-500/30" : "border-white/10")}>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Affected customers</p>
          <p className="text-xs text-zinc-500">
            {active
              ? `Closed since ${formatShortDateTime(closure.startsAt, settings.timezone)}`
              : `Closure ${formatShortDateTime(closure.startsAt, settings.timezone)} → ${formatShortDateTime(closure.endsAt, settings.timezone)}${closure.reopenedAt ? " (reopened early)" : ""}`}
            {" · "}
            {toNotify.length - pending.length}/{toNotify.length} messaged
          </p>
        </div>
        {next && nextMessage && (
          <a
            href={whatsappLink(next.phone, nextMessage)}
            target="_blank"
            rel="noreferrer"
            onClick={() => void markNotified(next.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
          >
            <Send className="size-4" /> Message next · {next.customerName.split(/\s+/)[0]} ({pending.length} left)
          </a>
        )}
        {!next && toNotify.length > 0 && (
          <Badge tone="emerald">
            <CircleCheck className="size-3.5" /> Everyone messaged
          </Badge>
        )}
        {onDismiss && (
          <button
            type="button"
            aria-label="Hide closure follow-up"
            onClick={onDismiss}
            className="text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {error && <p className="border-b border-white/10 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</p>}
      {summary.impacts.length === 0 && (
        <p className="p-6 text-center text-sm text-zinc-500">No walk-ins or bookings were affected.</p>
      )}

      <ul className="divide-y divide-zinc-800/70">
        {summary.impacts.map((i) => {
          const message = messageFor(i);
          const moved =
            i.action === "appointment_affected" && LIVE_APPT.has(i.status) && !i.stillInWindow && i.startsAt !== null;
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {i.code && <span className="font-mono text-amber-400">{i.code}</span>}
                  <span className="truncate">{i.customerName}</span>
                  {i.action === "ticket_cancelled" && <Badge tone="rose">Ticket cancelled</Badge>}
                  {i.action === "hold_released" && <Badge tone="zinc">Unpaid hold released</Badge>}
                  {i.action === "appointment_affected" && i.status === "cancelled" && <Badge tone="rose">Cancelled</Badge>}
                  {moved && <Badge tone="emerald">Moved</Badge>}
                  {i.needsRefund && <Badge tone="amber">Refund due</Badge>}
                </p>
                {i.startsAt && (
                  <p className="font-mono text-xs text-zinc-400">
                    {moved ? "now " : "booked "}
                    {formatShortDateTime(i.startsAt, settings.timezone)} · {barberName(i.barberId)}
                  </p>
                )}
                {message && i.action === "appointment_affected" && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                    <Sparkles className="size-3.5 text-amber-400" />
                    {i.offers.length
                      ? i.offers.map((o) => (
                          <span key={o.id} className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-zinc-300">
                            {formatShortDateTime(o.startsAt, settings.timezone)} · {barberName(o.barberId)}
                          </span>
                        ))
                      : "No times held yet — the customer can pick any free time from their pass."}
                  </p>
                )}
                {i.notifiedAt && message && (
                  <p className="text-[11px] text-emerald-400/80">
                    Messaged {formatShortDateTime(i.notifiedAt, settings.timezone)}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {message && (
                  <>
                    <a
                      href={whatsappLink(i.phone, message)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => void markNotified(i.id)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
                        i.notifiedAt
                          ? "border border-white/10 text-zinc-300 hover:border-white/15"
                          : "bg-amber-500 text-zinc-950 hover:bg-amber-400",
                      )}
                    >
                      <MessageCircle className="size-4" /> {i.notifiedAt ? "Again" : "WhatsApp"}
                    </a>
                    <a
                      href={smsLink(i.phone, message)}
                      onClick={() => void markNotified(i.id)}
                      aria-label={`SMS ${i.customerName}`}
                      className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:border-white/15"
                    >
                      <MessageSquare className="size-4" />
                    </a>
                  </>
                )}
                {moved && i.startsAt && (
                  <a
                    href={whatsappLink(
                      i.phone,
                      rescheduledMessage({
                        shopName: settings.shopName,
                        customerName: i.customerName,
                        barberName: barberName(i.barberId),
                        newTime: formatShortDateTime(i.startsAt, settings.timezone),
                        passUrl: passUrl(i),
                      }),
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm font-semibold text-zinc-300 hover:border-white/15"
                  >
                    <MessageCircle className="size-4" /> Confirm
                  </a>
                )}
                {message && i.action === "appointment_affected" && i.offers.length === 0 && (
                  <Button variant="secondary" size="sm" loading={busy === `propose:${i.id}`} onClick={() => void propose(i)}>
                    <Sparkles className="size-4" /> Hold new times
                  </Button>
                )}
                {message && i.action === "appointment_affected" && (
                  <CancelButton busy={busy === `cancel:${i.id}`} paid={i.hadPayment} onConfirm={() => void cancelBooking(i)} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CancelButton({ busy, paid, onConfirm }: { busy: boolean; paid: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <Button variant="danger" size="sm" loading={busy} onClick={onConfirm}>
      <Ban className="size-4" /> {paid ? "Cancel + flag refund" : "Yes, cancel"}
    </Button>
  ) : (
    <Button variant="ghost" size="sm" onClick={() => setArmed(true)}>
      <Ban className="size-4" /> Cancel booking
    </Button>
  );
}
