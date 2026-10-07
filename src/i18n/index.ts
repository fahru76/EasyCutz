/**
 * EZ-010 dictionaries. English is the source of truth for keys; TypeScript makes every
 * other language define exactly the same keys (see Dict in ./types).
 */
import type { Locale } from "./config";
import { booking as enBooking } from "./dictionaries/en/booking";
import { common as enCommon } from "./dictionaries/en/common";
import { errors as enErrors } from "./dictionaries/en/errors";
import { pass as enPass } from "./dictionaries/en/pass";
import { booking as msBooking } from "./dictionaries/ms/booking";
import { common as msCommon } from "./dictionaries/ms/common";
import { errors as msErrors } from "./dictionaries/ms/errors";
import { pass as msPass } from "./dictionaries/ms/pass";
import type { Dict } from "./types";

const en = { common: enCommon, errors: enErrors, booking: enBooking, pass: enPass };
export type Messages = Dict<typeof en>;

const ms: Messages = { common: msCommon, errors: msErrors, booking: msBooking, pass: msPass };

export const dictionaries: Record<Locale, Messages> = { en, ms };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}

/** "{n} ahead" + { n: 2 } -> "2 ahead". Unknown placeholders are left as written. */
export function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Text for an API error body ({ error, message }) in the active language. */
export function apiErrorMessage(t: Messages, body: unknown, fallback?: string): string {
  const code = (body as { error?: unknown } | null)?.error;
  if (typeof code === "string" && code in t.errors) return t.errors[code as keyof Messages["errors"]];
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message) return message;
  return fallback ?? t.errors.server_error;
}

export type { Locale } from "./config";
export { DEFAULT_LOCALE, intlLocale, isLocale, LOCALE_COOKIE, LOCALES, resolveLocale } from "./config";
