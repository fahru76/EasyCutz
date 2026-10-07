"use client";

import { LOCALES, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/format";

/** EN | BM segmented switch (EZ-010). Changing it keeps the cart and current step. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const names: Record<Locale, string> = { en: t.common.language.enName, ms: t.common.language.msName };
  const short: Record<Locale, string> = { en: t.common.language.en, ms: t.common.language.ms };
  return (
    <div
      role="radiogroup"
      aria-label={t.common.language.label}
      className={cn("inline-flex rounded-full border border-white/10 glass-inset p-0.5", className)}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={names[code]}
            lang={code}
            onClick={() => setLocale(code)}
            className={cn(
              "min-w-10 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400",
              active
                ? "bg-amber-500 text-zinc-950 shadow-[0_4px_14px_-6px_rgb(245_158_11/0.8)]"
                : "text-zinc-400 hover:text-zinc-100",
            )}
          >
            {short[code]}
          </button>
        );
      })}
    </div>
  );
}
