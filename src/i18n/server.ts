import "server-only";

import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";

/** The visitor's language for server rendering: saved cookie, then Accept-Language, then English. */
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
}
