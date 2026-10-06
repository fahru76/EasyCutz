/** Tiny history-based router shared by the next/navigation and next/link shims. */

/** "" locally, "/EasyCutz" on GitHub Pages. */
export const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

export const NAVIGATE_EVENT = "demo:navigate";
export const REFRESH_EVENT = "demo:refresh";

/** Path inside the app ("/pass/abc"), without the Pages base. */
export function appPath(pathname: string = location.pathname): string {
  const p = BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return p === "" ? "/" : p;
}

/** Turns an href ("/desk", "/EasyCutz/pass/x?y=1" or a same-origin URL) into an app path + query. */
export function toAppHref(href: string): string {
  if (/^https?:\/\//.test(href)) {
    const url = new URL(href);
    if (url.origin !== location.origin) return href;
    return appPath(url.pathname) + url.search + url.hash;
  }
  if (BASE && (href === BASE || href.startsWith(`${BASE}/`))) return appPath(href);
  return href;
}

export function hrefFor(appHref: string): string {
  return appHref.startsWith("/") ? `${BASE}${appHref}` : appHref;
}

export function navigate(href: string, replace = false): void {
  const target = toAppHref(href);
  if (/^https?:\/\//.test(target)) {
    location.href = target;
    return;
  }
  const url = hrefFor(target);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.scrollTo({ top: 0 });
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function refresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export class RedirectSignal extends Error {
  constructor(public readonly href: string) {
    super(`redirect:${href}`);
  }
}

export class NotFoundSignal extends Error {
  constructor() {
    super("not_found");
  }
}
