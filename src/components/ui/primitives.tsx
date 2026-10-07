"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn, initials } from "@/lib/format";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-[0_0_0_1px_rgb(245_158_11/0.4),0_8px_24px_-8px_rgb(245_158_11/0.6)]",
  secondary: "bg-white/[0.05] text-zinc-100 border border-white/10 hover:border-white/15 hover:bg-white/[0.08]",
  ghost: "text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.05]",
  danger: "bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20",
  success: "bg-emerald-500 text-zinc-950 hover:bg-emerald-400",
};
const sizeClass: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-4 text-sm gap-2 rounded-xl",
  lg: "h-14 px-6 text-base gap-2 rounded-2xl",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      disabled={isDisabled}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </motion.button>
  );
});

// ---------------------------------------------------------------------------
// Card / Section
// ---------------------------------------------------------------------------
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-white/10 glass", className)}
      {...rest}
    />
  );
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/90">{eyebrow}</p>
        )}
        <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-50 sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
export type BadgeTone = "amber" | "emerald" | "zinc" | "rose" | "sky";
const toneClass: Record<BadgeTone, string> = {
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  zinc: "bg-white/[0.08] text-zinc-400 border-white/15",
  rose: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  sky: "bg-sky-500/10 text-sky-300 border-sky-500/30",
};

export function Badge({
  tone = "zinc",
  mono = false,
  pulse = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  mono?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        mono && "font-mono tabular",
        toneClass[tone],
        className,
      )}
    >
      {pulse && <LiveDot tone={tone} />}
      {children}
    </span>
  );
}

const dotClass: Record<BadgeTone, string> = {
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
  zinc: "bg-zinc-500",
  rose: "bg-rose-400",
  sky: "bg-sky-400",
};

export function LiveDot({ tone = "emerald" }: { tone?: BadgeTone }) {
  return (
    <span className="relative flex size-2">
      {tone !== "zinc" && (
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", dotClass[tone])} />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", dotClass[tone])} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Avatar (photo or monogram)
// ---------------------------------------------------------------------------
export function Avatar({ name, src, size = 56 }: { name: string; src: string | null; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars may come from any storage bucket host
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-2xl border border-white/10 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex items-center justify-center rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-800 to-zinc-950 font-mono font-bold text-amber-400"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "border-amber-400 bg-amber-500" : "border-white/15 bg-white/10",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn("block size-5 rounded-full shadow", checked ? "ml-6 bg-zinc-950" : "ml-1 bg-zinc-400")}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-sm font-medium text-zinc-300">
        {label}
        {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

export const inputClass =
  "h-12 w-full rounded-xl border border-white/10 glass-inset px-4 text-[15px] text-zinc-100 placeholder:text-zinc-600 " +
  "outline-none transition focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20";

export function IconButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-300",
        "hover:border-white/15 hover:text-zinc-100 disabled:opacity-40",
        className,
      )}
      {...rest}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-white/[0.08]", className)} />;
}
