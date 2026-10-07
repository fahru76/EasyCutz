"use client";

import { Banknote, CreditCard, Landmark, ShieldCheck, Wallet } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useI18n } from "@/i18n/provider";
import { computeAmountDueNow } from "@/lib/cart";
import { cn, formatDuration, formatMoney } from "@/lib/format";
import { formatClock, formatLongDate } from "@/lib/time";
import type { Barber, BookingMode, CartTotals, PaymentOption, ShopSettings, TimeSlot } from "@/lib/types/domain";
import { useBookingStore } from "@/store/booking-store";
import { Card, Field, SectionTitle, inputClass } from "../ui/primitives";

export interface CheckoutErrors {
  name?: string;
  phone?: string;
  email?: string;
}

/** Fills {placeholders} in a dictionary string with React nodes. */
function richText(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((piece, i) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={i}>{key !== undefined && key in parts ? parts[key] : piece}</Fragment>;
  });
}

export function CheckoutStep({
  settings,
  totals,
  mode,
  slot,
  barber,
  paymentsEnabled,
  errors,
}: {
  settings: ShopSettings;
  totals: CartTotals;
  mode: BookingMode;
  slot: TimeSlot | null;
  barber: Barber | null;
  paymentsEnabled: boolean;
  errors: CheckoutErrors;
}) {
  const { t, locale, format } = useI18n();
  const c = t.booking.checkout;
  const customer = useBookingStore((s) => s.customer);
  const updateCustomer = useBookingStore((s) => s.updateCustomer);
  const paymentOption = useBookingStore((s) => s.paymentOption);
  const setPaymentOption = useBookingStore((s) => s.setPaymentOption);

  const deposit = computeAmountDueNow(totals.priceCents, "deposit", settings);
  const options: Array<{ id: PaymentOption; title: string; detail: string; amount: string; icon: ReactNode }> = [
    {
      id: "cash_on_site",
      title: c.options.cashTitle,
      detail: c.options.cashDetail,
      amount: formatMoney(0, settings.currency),
      icon: <Banknote className="size-5" />,
    },
    {
      id: "deposit",
      title: c.options.depositTitle,
      detail: format(c.options.depositDetail, { percent: settings.depositPercent }),
      amount: formatMoney(deposit, settings.currency),
      icon: <Wallet className="size-5" />,
    },
    {
      id: "full",
      title: c.options.fullTitle,
      detail: c.options.fullDetail,
      amount: formatMoney(totals.priceCents, settings.currency),
      icon: <CreditCard className="size-5" />,
    },
  ];

  return (
    <section className="space-y-8">
      <div>
        <SectionTitle eyebrow={format(t.booking.flow.stepEyebrow, { n: 4 })} title={c.title} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={c.name} htmlFor="name" error={errors.name}>
            <input
              id="name"
              autoComplete="name"
              className={inputClass}
              placeholder={c.namePlaceholder}
              value={customer.name}
              onChange={(e) => updateCustomer({ name: e.target.value })}
              aria-invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label={c.phone} hint={c.phoneHint} htmlFor="phone" error={errors.phone}>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={cn(inputClass, "font-mono")}
              placeholder="012-345 6789"
              value={customer.phone}
              onChange={(e) => updateCustomer({ phone: e.target.value })}
              aria-invalid={Boolean(errors.phone)}
            />
          </Field>
          <Field label={c.email} hint={c.emailHint} htmlFor="email" error={errors.email}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={inputClass}
              placeholder={c.emailPlaceholder}
              value={customer.email}
              onChange={(e) => updateCustomer({ email: e.target.value })}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>
          <Field label={c.notes} hint={c.notesHint} htmlFor="notes">
            <input
              id="notes"
              className={inputClass}
              placeholder={c.notesPlaceholder}
              maxLength={500}
              value={customer.notes}
              onChange={(e) => updateCustomer({ notes: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">{c.payment}</h3>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={c.paymentAria}>
          {options.map((o) => {
            const online = o.id !== "cash_on_site";
            const disabled = online && (!paymentsEnabled || totals.priceCents === 0);
            const selected = paymentOption === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => setPaymentOption(o.id)}
                className={cn(
                  "flex flex-col rounded-2xl border p-4 text-left transition-all",
                  selected
                    ? "border-amber-500/70 bg-amber-500/[0.07]"
                    : "border-white/10 glass hover:border-white/15",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className={cn("text-zinc-400", selected && "text-amber-400")}>{o.icon}</span>
                  <span className="font-mono text-sm font-bold tabular text-zinc-100">{o.amount}</span>
                </span>
                <span className="mt-3 font-semibold text-zinc-100">{o.title}</span>
                <span className="text-xs text-zinc-500">{o.detail}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          {paymentsEnabled ? (
            <>
              <ShieldCheck className="size-4 text-emerald-400" /> {c.secureStripe}
              <Landmark className="size-3.5" /> {c.fpx} <CreditCard className="size-3.5" /> {c.cards}
            </>
          ) : (
            <>{c.paymentsUnavailable}</>
          )}
        </p>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-zinc-300">{c.summary}</h3>
        <p className="mt-1 text-sm text-zinc-400">
          {mode === "scheduled" && slot ? (
            richText(c.dateAtTime, {
              date: <span className="text-zinc-200">{formatLongDate(slot.startsAt, settings.timezone, locale)}</span>,
              time: <span className="font-mono text-amber-400">{formatClock(slot.startsAt, settings.timezone, locale)}</span>,
            })
          ) : (
            <span className="text-zinc-200">{c.walkInSummary}</span>
          )}
          {" · "}
          {barber ? barber.displayName : c.firstAvailableBarber}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {totals.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span className={cn(l.type === "addon" ? "text-zinc-400" : "text-zinc-200")}>
                {l.type === "addon" && "+ "}
                {l.name}
              </span>
              <span className="font-mono tabular text-zinc-400">{formatMoney(l.priceCents, settings.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-white/10 pt-3 font-semibold">
          <span>
            {c.total}{" "}
            <span className="font-mono text-xs font-normal text-zinc-500">· {formatDuration(totals.durationMin, locale)}</span>
          </span>
          <span className="font-mono tabular text-amber-400">{formatMoney(totals.priceCents, settings.currency)}</span>
        </div>
      </Card>
    </section>
  );
}
