"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { formatDuration, formatMoney } from "@/lib/format";
import { Button } from "../ui/primitives";

export function SummaryBar({
  visible,
  itemCount,
  durationMin,
  priceCents,
  currency,
  ctaLabel,
  ctaDisabled,
  loading,
  hint,
  onCta,
  onBack,
}: {
  visible: boolean;
  itemCount: number;
  durationMin: number;
  priceCents: number;
  currency: string;
  ctaLabel: string;
  ctaDisabled: boolean;
  loading: boolean;
  hint: string | null;
  onCta: () => void;
  onBack: (() => void) | null;
}) {
  const { t, locale, format } = useI18n();
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/10 glass-strong pt-3"
        >
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={t.common.actions.back}
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-zinc-300 hover:border-white/15"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-500">
                {hint ??
                  format(itemCount === 1 ? t.booking.summary.itemsOne : t.booking.summary.itemsOther, {
                    n: itemCount,
                    duration: formatDuration(durationMin, locale),
                  })}
              </p>
              <motion.p
                key={priceCents}
                initial={{ opacity: 0.4, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="font-mono text-xl font-bold tabular text-zinc-50"
              >
                {formatMoney(priceCents, currency)}
              </motion.p>
            </div>
            <Button size="lg" onClick={onCta} disabled={ctaDisabled} loading={loading} className="shrink-0">
              {ctaLabel}
              {!loading && <ArrowRight className="size-5" />}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
