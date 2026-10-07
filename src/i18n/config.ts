/** EZ-010: supported languages. Add a code here, then a dictionary folder, to add a language. */
export const LOCALES = ["en", "ms"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
/** Cookie that remembers the visitor's choice (no URL change). */
export const LOCALE_COOKIE = "ez_lang";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Intl locale used for dates and times in the shop. */
export function intlLocale(locale: Locale): string {
  return locale === "ms" ? "ms-MY" : "en-MY";
}

/** Saved choice first, then the browser's preference, then English. */
export function resolveLocale(saved: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(saved)) return saved;
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .filter(Boolean);
  for (const tag of prefs) {
    const base = tag.split("-")[0];
    if (base === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

/** Reads the saved locale from a raw `document.cookie` string. */
export function localeFromCookieString(cookie: string): string | null {
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)) : null;
}
