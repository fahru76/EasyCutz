"use client";

import { Banknote, CreditCard, Landmark, ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
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
  const customer = useBookingStore((s) => s.customer);
  const updateCustomer = useBookingStore((s) => s.updateCustomer);
  const paymentOption = useBookingStore((s) => s.paymentOption);
  const setPaymentOption = useBookingStore((s) => s.setPaymentOption);

  const deposit = computeAmountDueNow(totals.priceCents, "deposit", settings);
  const options: Array<{ id: PaymentOption; title: string; detail: string; amount: string; icon: ReactNode }> = [
    {
      id: "cash_on_site",
      title: "Pay at the shop",
      detail: "Cash, card or e-wallet after your cut",
      amount: formatMoney(0, settings.currency),
      icon: <Banknote className="size-5" />,
    },
    {
      id: "deposit",
      title: "Pay a deposit",
      detail: `${settings.depositPercent}% now, rest at the shop`,
      amount: formatMoney(deposit, settings.currency),
      icon: <Wallet className="size-5" />,
    },
    {
      id: "full",
      title: "Pay in full",
      detail: "Skip the counter — just walk out fresh",
      amount: formatMoney(totals.priceCents, settings.currency),
      icon: <CreditCard className="size-5" />,
    },
  ];

  return (
    <section className="space-y-8">
      <div>
        <SectionTitle eyebrow="Step 4" title="Your details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="name" error={errors.name}>
            <input
              id="name"
              autoComplete="name"
              className={inputClass}
              placeholder="e.g. Ahmad Rizal"
              value={customer.name}
              onChange={(e) => updateCustomer({ name: e.target.value })}
              aria-invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label="Mobile (WhatsApp)" hint="We'll ping you near your turn" htmlFor="phone" error={errors.phone}>
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
          <Field label="Email" hint="Optional · receipts" htmlFor="email" error={errors.email}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={inputClass}
              placeholder="you@example.com"
              value={customer.email}
              onChange={(e) => updateCustomer({ email: e.target.value })}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>
          <Field label="Notes for your barber" hint="Optional" htmlFor="notes">
            <input
              id="notes"
              className={inputClass}
              placeholder="e.g. keep the length on top"
              maxLength={500}
              value={customer.notes}
              onChange={(e) => updateCustomer({ notes: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Payment</h3>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Payment option">
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
                    : "border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700",
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
              <ShieldCheck className="size-4 text-emerald-400" /> Secure checkout by Stripe ·
              <Landmark className="size-3.5" /> FPX online banking · <CreditCard className="size-3.5" /> cards
            </>
          ) : (
            <>Online payment is currently unavailable — you can pay at the shop.</>
          )}
        </p>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-zinc-300">Summary</h3>
        <p className="mt-1 text-sm text-zinc-400">
          {mode === "scheduled" && slot ? (
            <>
              <span className="text-zinc-200">{formatLongDate(slot.startsAt, settings.timezone)}</span> at{" "}
              <span className="font-mono text-amber-400">{formatClock(slot.startsAt, settings.timezone)}</span>
            </>
          ) : (
            <span className="text-zinc-200">Virtual walk-in · live queue</span>
          )}
          {" · "}
          {barber ? barber.displayName : "First available barber"}
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
        <div className="mt-3 flex justify-between border-t border-zinc-800 pt-3 font-semibold">
          <span>
            Total <span className="font-mono text-xs font-normal text-zinc-500">· {formatDuration(totals.durationMin)}</span>
          </span>
          <span className="font-mono tabular text-amber-400">{formatMoney(totals.priceCents, settings.currency)}</span>
        </div>
      </Card>
    </section>
  );
}
