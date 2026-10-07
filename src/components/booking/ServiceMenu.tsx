"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Check, Crown, Flame, Plus, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { MAX_SERVICES } from "@/lib/cart";
import { cn, formatDuration, formatMoney } from "@/lib/format";
import { SERVICE_CATEGORIES, type Addon, type Service, type ServiceCategory } from "@/lib/types/domain";
import { useBookingStore } from "@/store/booking-store";
import { Badge, SectionTitle, Switch } from "../ui/primitives";

export function ServiceMenu({
  services,
  addons,
  currency,
}: {
  services: Service[];
  addons: Addon[];
  currency: string;
}) {
  const { t, locale, format } = useI18n();
  const serviceIds = useBookingStore((s) => s.serviceIds);
  const addonIds = useBookingStore((s) => s.addonIds);
  const toggleService = useBookingStore((s) => s.toggleService);
  const toggleAddon = useBookingStore((s) => s.toggleAddon);

  const categories = useMemo(
    () => SERVICE_CATEGORIES.filter((c) => services.some((s) => s.category === c.id)),
    [services],
  );
  const [active, setActive] = useState<ServiceCategory>(categories[0]?.id ?? "haircut");
  const visible = services.filter((s) => s.category === active);
  const countByCategory = (id: ServiceCategory) =>
    services.filter((s) => s.category === id && serviceIds.includes(s.id)).length;

  return (
    <section aria-labelledby="menu-title">
      <SectionTitle eyebrow={format(t.booking.flow.stepEyebrow, { n: 1 })} title={t.booking.menu.title} />

      <LayoutGroup id="service-tabs">
        <div role="tablist" className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto px-4">
          {categories.map((c) => {
            const selected = c.id === active;
            const count = countByCategory(c.id);
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(c.id)}
                className={cn(
                  "relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  selected ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-full bg-amber-500"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {t.booking.menu.categories[c.id]}
                  {count > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 font-mono text-[10px]",
                        selected ? "glass-inset" : "bg-amber-500/20 text-amber-400",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <AnimatePresence mode="wait" initial={false}>
        <motion.ul
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="grid gap-3 sm:grid-cols-2"
        >
          {visible.map((service) => {
            const selected = serviceIds.includes(service.id);
            const atLimit = !selected && serviceIds.length >= MAX_SERVICES;
            return (
              <li key={service.id}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => toggleService(service.id)}
                  disabled={atLimit}
                  aria-pressed={selected}
                  className={cn(
                    "group relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all",
                    selected
                      ? "border-amber-500/70 bg-amber-500/[0.07] shadow-[0_0_0_1px_rgb(245_158_11/0.25)]"
                      : "border-white/10 glass hover:border-white/15",
                    atLimit && "opacity-40",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-zinc-50">{service.name}</h3>
                      {service.isPopular && (
                        <Badge tone="amber">
                          <Flame className="size-3" /> {t.booking.menu.popular}
                        </Badge>
                      )}
                      {service.category === "combo" && (
                        <Badge tone="sky">
                          <Crown className="size-3" /> {t.booking.menu.combo}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{service.description}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge mono tone={selected ? "amber" : "zinc"}>{formatMoney(service.priceCents, currency)}</Badge>
                      <Badge mono>{formatDuration(service.durationMin, locale)}</Badge>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selected
                        ? "border-amber-400 bg-amber-500 text-zinc-950"
                        : "border-white/15 text-zinc-500 group-hover:border-zinc-500",
                    )}
                    aria-hidden
                  >
                    {selected ? <Check className="size-4" strokeWidth={3} /> : <Plus className="size-4" />}
                  </span>
                </motion.button>
              </li>
            );
          })}
        </motion.ul>
      </AnimatePresence>

      {addons.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Sparkles className="size-4 text-amber-500" /> {t.booking.menu.addons}
          </h3>
          <ul className="divide-y divide-zinc-800/70 overflow-hidden rounded-2xl border border-white/10 glass">
            {addons.map((addon) => {
              const on = addonIds.includes(addon.id);
              const disabled = serviceIds.length === 0;
              return (
                <li key={addon.id} className={cn("flex items-center gap-3 p-4", disabled && "opacity-50")}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-100">{addon.name}</p>
                    <p className="text-xs text-zinc-500">{addon.description}</p>
                  </div>
                  <span className="font-mono text-xs text-zinc-400 tabular">
                    +{formatMoney(addon.priceCents, currency)}
                    {addon.durationMin > 0 && <span className="text-zinc-600"> · {format(t.booking.menu.addonMinutes, { n: addon.durationMin })}</span>}
                  </span>
                  <Switch
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggleAddon(addon.id)}
                    label={format(t.booking.menu.addAddon, { name: addon.name })}
                  />
                </li>
              );
            })}
          </ul>
          {serviceIds.length === 0 && (
            <p className="mt-2 text-xs text-zinc-500">{t.booking.menu.unlockAddons}</p>
          )}
        </div>
      )}
    </section>
  );
}
