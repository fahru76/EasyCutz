"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { CalendarClock, Check, TicketCheck, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLiveCatalog } from "@/hooks/use-live-catalog";
import { useLiveShop } from "@/hooks/use-live-shop";
import { useNow } from "@/hooks/use-now";
import { computeAmountDueNow, computeCartTotals } from "@/lib/cart";
import { cn, formatMoney, formatQueueLine, formatWait, normalizePhone } from "@/lib/format";
import { buildQueueSnapshot, estimateWalkIn } from "@/lib/queue";
import type { ApiError, BookingMode, Catalog, CreateBookingResponse } from "@/lib/types/domain";
import { BOOKING_STEPS, useBookingStore, type BookingStep } from "@/store/booking-store";
import { SiteHeader } from "../ui/SiteHeader";
import { BarberRoster } from "./BarberRoster";
import { CheckoutStep, type CheckoutErrors } from "./CheckoutStep";
import { ScheduleStep } from "./ScheduleStep";
import { ServiceMenu } from "./ServiceMenu";
import { SummaryBar } from "./SummaryBar";
import { WalkInStep } from "./WalkInStep";

const STEP_LABEL: Record<BookingStep, string> = {
  services: "Services",
  barber: "Barber",
  when: "When",
  details: "Details",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validateCustomer(c: { name: string; phone: string; email: string }): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (c.name.trim().length < 2) errors.name = "Enter your name";
  if (!normalizePhone(c.phone)) errors.phone = "Enter a valid mobile number";
  if (c.email.trim() && !EMAIL_RE.test(c.email.trim())) errors.email = "Enter a valid email";
  return errors;
}

export function BookingFlow({ catalog }: { catalog: Catalog }) {
  const { shifts, paymentsEnabled } = catalog;
  // EZ-009: menu, prices and rules update live when the owner edits them.
  const { settings, services, addons } = useLiveCatalog({
    settings: catalog.settings,
    services: catalog.services,
    addons: catalog.addons,
  });
  const router = useRouter();
  const now = useNow(15_000);
  const live = useLiveShop({ initialBarbers: catalog.barbers, timezone: settings.timezone });

  const store = useBookingStore();
  const { step, mode, serviceIds, addonIds, barberId, slot, paymentOption, customer } = store;

  const totals = useMemo(
    () => computeCartTotals(services, addons, serviceIds, addonIds),
    [services, addons, serviceIds, addonIds],
  );
  const queueInput = useMemo(
    () => ({ now, barbers: live.barbers, tickets: live.tickets, appointments: live.appointments }),
    [now, live.barbers, live.tickets, live.appointments],
  );
  const snapshot = useMemo(() => buildQueueSnapshot(queueInput), [queueInput]);
  const walkInEstimate = useMemo(
    () => estimateWalkIn(queueInput, totals.durationMin || 30, barberId === "any" ? null : barberId),
    [queueInput, totals.durationMin, barberId],
  );
  const selectedBarber = barberId === "any" ? null : (live.barbers.find((b) => b.id === barberId) ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const customerErrors = validateCustomer(customer);

  // Remove anything the owner just hid from the menu.
  const pruneCart = store.pruneCart;
  useEffect(() => {
    pruneCart(new Set(services.map((s) => s.id)), new Set(addons.map((a) => a.id)));
  }, [services, addons, pruneCart]);

  // Online payment options are hidden when Stripe isn't configured.
  useEffect(() => {
    if (!paymentsEnabled && paymentOption !== "cash_on_site") store.setPaymentOption("cash_on_site");
  }, [paymentsEnabled, paymentOption, store]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const stepValid: Record<BookingStep, boolean> = {
    services: serviceIds.length > 0,
    barber: mode === "scheduled" || !selectedBarber || selectedBarber.isOnDuty,
    when: mode === "scheduled" ? slot !== null : walkInEstimate !== null,
    details: Object.keys(customerErrors).length === 0,
  };

  const stepIndex = BOOKING_STEPS.indexOf(step);
  const dueNow = computeAmountDueNow(totals.priceCents, paymentOption, settings);

  const ctaLabel =
    step !== "details"
      ? "Continue"
      : dueNow > 0
        ? `Pay ${formatMoney(dueNow, settings.currency)}`
        : mode === "walk_in"
          ? "Get my ticket"
          : "Confirm booking";

  const hint =
    step === "when" && mode === "walk_in" && walkInEstimate
      ? formatQueueLine(walkInEstimate.waitMin, walkInEstimate.aheadCount)
      : null;

  async function submit() {
    setShowErrors(true);
    if (!stepValid.details) return;
    if (mode === "scheduled" && !slot) {
      store.goTo("when");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        mode,
        ...(mode === "scheduled" && slot ? { startsAt: slot.startsAt } : {}),
        serviceIds,
        addonIds,
        barberId: barberId === "any" ? null : barberId,
        paymentOption,
        customer: {
          name: customer.name.trim(),
          phone: customer.phone,
          email: customer.email.trim(),
          notes: customer.notes.trim(),
        },
      };
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        const err = json as ApiError;
        setToast(err.message ?? "Booking failed. Please try again.");
        if (err.error === "slot_unavailable" || err.error === "slot_in_past") {
          store.setSlot(null);
          store.goTo("when");
        }
        return;
      }
      const result = json as CreateBookingResponse;
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      router.push(new URL(result.passUrl).pathname);
      store.reset();
    } catch {
      setToast("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onCta() {
    if (step === "details") {
      void submit();
      return;
    }
    if (stepValid[step]) store.next();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader shopName={settings.shopName} status={live.status} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-40 pt-6">
        <Hero
          mode={mode}
          onMode={(m) => store.setMode(m)}
          waitMin={snapshot.nextWalkIn?.waitMin ?? null}
          waiting={snapshot.nextWalkIn?.aheadCount ?? snapshot.waiting.length}
          chairs={snapshot.onDutyIds.length}
        />

        <nav aria-label="Booking steps" className="my-6">
          <ol className="flex items-center gap-2">
            {BOOKING_STEPS.map((s, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={s} className="flex flex-1 items-center gap-2">
                  <button
                    type="button"
                    disabled={!done}
                    onClick={() => store.goTo(s)}
                    className={cn(
                      "flex items-center gap-2 text-xs font-semibold transition-colors",
                      current ? "text-amber-400" : done ? "text-zinc-300 hover:text-zinc-100" : "text-zinc-600",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border font-mono text-[11px]",
                        current
                          ? "border-amber-500 bg-amber-500 text-zinc-950"
                          : done
                            ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                            : "border-zinc-800 text-zinc-600",
                      )}
                    >
                      {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="hidden sm:inline">{STEP_LABEL[s]}</span>
                  </button>
                  {i < BOOKING_STEPS.length - 1 && (
                    <span className={cn("h-px flex-1", done ? "bg-zinc-600" : "bg-zinc-800")} aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {step === "services" && <ServiceMenu services={services} addons={addons} currency={settings.currency} />}
            {step === "barber" && <BarberRoster barbers={live.barbers} snapshot={snapshot} mode={mode} />}
            {step === "when" && (
              <section>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/90">Step 3</p>
                    <h2 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
                      {mode === "scheduled" ? "Pick a date & time" : "Join the live queue"}
                    </h2>
                  </div>
                  <ModeSwitch mode={mode} onMode={(m) => store.setMode(m)} compact />
                </div>
                {mode === "scheduled" ? (
                  <ScheduleStep
                    settings={settings}
                    shifts={shifts}
                    barbers={live.barbers}
                    durationMin={totals.durationMin}
                  />
                ) : (
                  <WalkInStep
                    snapshot={snapshot}
                    estimate={walkInEstimate}
                    barbers={live.barbers}
                    selectedBarber={selectedBarber}
                    timezone={settings.timezone}
                  />
                )}
              </section>
            )}
            {step === "details" && (
              <CheckoutStep
                settings={settings}
                totals={totals}
                mode={mode}
                slot={slot}
                barber={selectedBarber}
                paymentsEnabled={paymentsEnabled}
                errors={showErrors ? customerErrors : {}}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <SummaryBar
        visible={serviceIds.length > 0}
        itemCount={totals.lines.length}
        durationMin={totals.durationMin}
        priceCents={totals.priceCents}
        currency={settings.currency}
        ctaLabel={ctaLabel}
        ctaDisabled={step === "details" ? submitting : !stepValid[step]}
        loading={submitting}
        hint={hint}
        onCta={onCta}
        onBack={stepIndex > 0 ? () => store.back() : null}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed inset-x-4 top-20 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-rose-500/40 bg-zinc-950/95 p-4 text-sm text-rose-100 shadow-2xl backdrop-blur"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-rose-400" />
            <p className="flex-1">{toast}</p>
            <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="text-zinc-400">
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Hero({
  mode,
  onMode,
  waitMin,
  waiting,
  chairs,
}: {
  mode: BookingMode;
  onMode: (m: BookingMode) => void;
  waitMin: number | null;
  waiting: number;
  chairs: number;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-950 p-5 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-amber-500/10 blur-3xl"
      />
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber-500">Barbershop · Kuala Lumpur</p>
      <h1 className="mt-2 max-w-xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
        Fresh cut. <span className="text-amber-500">Zero</span> waiting room.
      </h1>
      <p className="mt-2 max-w-lg text-sm text-zinc-400 sm:text-base">
        Book an exact time, or grab a live queue number and show up when your chair is ready.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <ModeSwitch mode={mode} onMode={onMode} />
        <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 font-mono text-xs">
          {waitMin === null ? (
            <span className="text-zinc-500">Queue closed · booking open</span>
          ) : (
            <>
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-zinc-200">{waitMin <= 1 ? "No wait" : `${formatWait(waitMin)} wait`}</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">{waiting} ahead</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">
                {chairs} chair{chairs === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ModeSwitch({
  mode,
  onMode,
  compact = false,
}: {
  mode: BookingMode;
  onMode: (m: BookingMode) => void;
  compact?: boolean;
}) {
  const items: Array<{ id: BookingMode; label: string; short: string; icon: React.ReactNode }> = [
    { id: "walk_in", label: "Join live queue", short: "Walk-in", icon: <TicketCheck className="size-4" /> },
    { id: "scheduled", label: "Book a time", short: "Schedule", icon: <CalendarClock className="size-4" /> },
  ];
  return (
    <LayoutGroup id={compact ? "mode-compact" : "mode-hero"}>
      <div role="radiogroup" aria-label="Booking mode" className="inline-flex rounded-full border border-zinc-800 bg-zinc-950/70 p-1">
        {items.map((it) => {
          const active = mode === it.id;
          return (
            <button
              key={it.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onMode(it.id)}
              className={cn(
                "relative flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors",
                compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
                active ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              {active && (
                <motion.span
                  layoutId="mode-pill"
                  className="absolute inset-0 rounded-full bg-amber-500"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {it.icon}
                {compact ? it.short : it.label}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
