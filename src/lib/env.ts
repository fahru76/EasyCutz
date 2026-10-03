/**
 * Environment access.
 *
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them
 * into the browser bundle. Server secrets are read lazily and only on the server.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in (see README → Setup).`,
    );
  }
  return value.trim();
}

export const publicEnv = {
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  /** Publishable key (sb_publishable_…) — safe in the browser; RLS protects data. */
  get supabasePublishableKey(): string {
    return required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  /** Canonical public origin, e.g. https://book.easycutz.my (optional; falls back to request origin). */
  get siteUrl(): string | null {
    const v = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    return v ? v.replace(/\/+$/, "") : null;
  },
};

export const serverEnv = {
  /** Secret key (sb_secret_…) or legacy service_role JWT. Server only — bypasses RLS. */
  get supabaseSecretKey(): string {
    return required(
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get stripeSecretKey(): string | null {
    return process.env.STRIPE_SECRET_KEY?.trim() || null;
  },
  get stripeWebhookSecret(): string | null {
    return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  },
  get paymentsEnabled(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim());
  },
};
