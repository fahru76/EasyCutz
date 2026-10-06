/**
 * Serves the app's own /api route handlers (src/app/api/**) inside the browser:
 * fetch("/api/...") is routed to the real handler modules instead of the network.
 */
import { appPath, BASE } from "./shims/router";

// Route params differ per handler ({ token } or none); matched at runtime from the URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Promise<Response>;
type RouteModule = Partial<Record<string, Handler>>;

const routes: Array<{ pattern: RegExp; keys: string[]; load: () => Promise<RouteModule> }> = [
  { pattern: /^\/api\/availability$/, keys: [], load: () => import("@/app/api/availability/route") },
  { pattern: /^\/api\/bookings$/, keys: [], load: () => import("@/app/api/bookings/route") },
  {
    pattern: /^\/api\/bookings\/([^/]+)\/cancel$/,
    keys: ["token"],
    load: () => import("@/app/api/bookings/[token]/cancel/route"),
  },
  {
    pattern: /^\/api\/bookings\/([^/]+)\/pay$/,
    keys: ["token"],
    load: () => import("@/app/api/bookings/[token]/pay/route"),
  },
  {
    pattern: /^\/api\/bookings\/([^/]+)\/reschedule$/,
    keys: ["token"],
    load: () => import("@/app/api/bookings/[token]/reschedule/route"),
  },
  { pattern: /^\/api\/desk\/closure$/, keys: [], load: () => import("@/app/api/desk/closure/route") },
  { pattern: /^\/api\/desk\/reschedule$/, keys: [], load: () => import("@/app/api/desk/reschedule/route") },
];

export function installApi(): void {
  const networkFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const incoming = new Request(input, init);
    const url = new URL(incoming.url);
    if (url.origin !== location.origin) return networkFetch(input, init);

    const path = appPath(url.pathname);
    for (const route of routes) {
      const match = route.pattern.exec(path);
      if (!match) continue;

      const mod = await route.load();
      const handler = mod[incoming.method.toUpperCase()];
      if (!handler) return Response.json({ error: "method_not_allowed" }, { status: 405 });

      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const request = new Request(`${location.origin}${BASE}${path}${url.search}`, incoming);
      return handler(request, { params: Promise.resolve(params) });
    }
    return networkFetch(input, init);
  };
}
