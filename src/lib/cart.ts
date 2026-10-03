/**
 * Cart maths used for live UI feedback. The database (price_cart /
 * amount_due_now) recomputes everything authoritatively on submit, and these
 * functions intentionally implement the same rules so the UI never lies.
 */
import type { Addon, CartLine, CartTotals, PaymentOption, Service, ShopSettings } from "./types/domain";

export const MAX_SERVICES = 6;
export const MAX_ADDONS = 6;

export function computeCartTotals(
  services: readonly Service[],
  addons: readonly Addon[],
  selectedServiceIds: readonly string[],
  selectedAddonIds: readonly string[],
): CartTotals {
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const addonById = new Map(addons.map((a) => [a.id, a]));
  const lines: CartLine[] = [];

  for (const id of selectedServiceIds) {
    const s = serviceById.get(id);
    if (s) lines.push({ id: s.id, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents, type: "service" });
  }
  // Add-ons only count when at least one service is selected (mirrors price_cart).
  if (lines.length > 0) {
    for (const id of selectedAddonIds) {
      const a = addonById.get(id);
      if (a) lines.push({ id: a.id, name: a.name, durationMin: a.durationMin, priceCents: a.priceCents, type: "addon" });
    }
  }

  return {
    lines,
    durationMin: lines.reduce((sum, l) => sum + l.durationMin, 0),
    priceCents: lines.reduce((sum, l) => sum + l.priceCents, 0),
  };
}

/** Mirrors public.amount_due_now(). */
export function computeAmountDueNow(
  priceCents: number,
  option: PaymentOption,
  settings: Pick<ShopSettings, "depositPercent" | "minDepositCents">,
): number {
  if (option === "cash_on_site" || priceCents <= 0) return 0;
  if (option === "full") return priceCents;
  const pct = Math.round((priceCents * settings.depositPercent) / 100);
  return Math.min(priceCents, Math.max(settings.minDepositCents, pct));
}

export function toggleId(list: readonly string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (list.length >= max) return [...list];
  return [...list, id];
}
