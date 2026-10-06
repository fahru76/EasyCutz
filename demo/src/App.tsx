import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { resetDatabase } from "./db/client";
import { resetCatalog } from "./fake/supabase";
import { addSampleActivity } from "./sample-activity";
import {
  appPath,
  hrefFor,
  navigate,
  NAVIGATE_EVENT,
  NotFoundSignal,
  RedirectSignal,
  REFRESH_EVENT,
} from "./shims/router";

// Page props differ per route ({ token } or none); matched at runtime from the URL.
type PageProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Promise<any>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type PageModule = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: PageProps & any) => Promise<ReactNode> | ReactNode;
  metadata?: { title?: unknown };
};

/** The app's real page components (src/app/**), rendered in the browser. */
const pages: Array<{ pattern: RegExp; keys: string[]; load: () => Promise<PageModule> }> = [
  { pattern: /^\/$/, keys: [], load: () => import("@/app/page") },
  { pattern: /^\/pass\/([^/]+)$/, keys: ["token"], load: () => import("@/app/pass/[token]/page") },
  { pattern: /^\/desk$/, keys: [], load: () => import("@/app/desk/page") },
  { pattern: /^\/desk\/login$/, keys: [], load: () => import("@/app/desk/login/page") },
  { pattern: /^\/desk\/admin$/, keys: [], load: () => import("@/app/desk/admin/page") },
  { pattern: /^\/desk\/checkin\/([^/]+)$/, keys: ["token"], load: () => import("@/app/desk/checkin/[token]/page") },
];

type View = { kind: "loading" } | { kind: "page"; node: ReactNode } | { kind: "not_found" } | { kind: "error"; message: string };

async function renderRoute(): Promise<View> {
  const path = appPath();
  for (const page of pages) {
    const match = page.pattern.exec(path);
    if (!match) continue;
    const params = Object.fromEntries(page.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const searchParams = Object.fromEntries(new URLSearchParams(location.search));
    const mod = await page.load();
    const title = typeof mod.metadata?.title === "string" ? mod.metadata.title : null;
    document.title = title ? `${title} · EasyCutz demo` : "EasyCutz — prototype demo";
    try {
      const node = await mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
      return { kind: "page", node };
    } catch (err) {
      if (err instanceof RedirectSignal) {
        navigate(err.href, true);
        return { kind: "loading" };
      }
      if (err instanceof NotFoundSignal) return { kind: "not_found" };
      throw err;
    }
  }
  return { kind: "not_found" };
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [routeKey, setRouteKey] = useState(0);
  const seq = useRef(0);

  const load = useCallback(async (soft: boolean) => {
    const id = ++seq.current;
    if (!soft) setView({ kind: "loading" });
    try {
      const next = await renderRoute();
      if (id === seq.current && next.kind !== "loading") setView(next);
    } catch (err) {
      console.error(err);
      if (id === seq.current) setView({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    const onNavigate = () => {
      setRouteKey((k) => k + 1);
      void load(false);
    };
    const onRefresh = () => void load(true);
    void load(false);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener("popstate", onNavigate);
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [load]);

  return (
    <>
      <DemoBar />
      <ErrorBoundary key={routeKey}>
        {view.kind === "loading" && <Centered>Loading…</Centered>}
        {view.kind === "page" && view.node}
        {view.kind === "not_found" && (
          <Centered>
            <p className="text-lg font-semibold">Page not found</p>
            <a className="mt-3 text-amber-400 hover:underline" href={hrefFor("/")} onClick={go("/")}>
              Back to booking
            </a>
          </Centered>
        )}
        {view.kind === "error" && (
          <Centered>
            <p className="text-lg font-semibold">Something went wrong</p>
            <pre className="mt-3 max-w-lg whitespace-pre-wrap font-mono text-xs text-rose-300">{view.message}</pre>
          </Centered>
        )}
      </ErrorBoundary>
    </>
  );
}

function go(path: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };
}

function DemoBar() {
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resetDatabase();
      resetCatalog();
      await addSampleActivity();
      navigate(appPath() + location.search, true);
    } finally {
      setBusy(false);
    }
  };
  const link = "rounded-full px-2 py-1 hover:bg-amber-500/15 hover:text-amber-200 sm:px-2.5";
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 text-xs text-amber-100/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
        <span className="font-mono uppercase tracking-[0.18em] text-amber-400">
          <span className="sm:hidden">Demo</span>
          <span className="hidden sm:inline">Prototype demo</span>
        </span>
        <span className="hidden text-amber-100/60 lg:inline">Sample data, stored only in this browser. The demo shop is open 24/7. No real bookings or payments.</span>
        <nav className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <a className={link} href={hrefFor("/")} onClick={go("/")}>Customer</a>
          <a className={link} href={hrefFor("/desk")} onClick={go("/desk")}>
            <span className="sm:hidden">Desk</span>
            <span className="hidden sm:inline">Quick-Desk</span>
          </a>
          <a className={link} href={hrefFor("/desk/admin")} onClick={go("/desk/admin")}>
            <span className="sm:hidden">Admin</span>
            <span className="hidden sm:inline">Owner admin</span>
          </a>
          <button type="button" className={`${link} disabled:opacity-50`} onClick={() => void reset()} disabled={busy}>
            {busy ? "Resetting…" : (
              <>
                <span className="sm:hidden">Reset</span>
                <span className="hidden sm:inline">Reset demo</span>
              </>
            )}
          </button>
        </nav>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center px-6 text-center text-zinc-300">
      {children}
    </main>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Centered>
          <p className="text-lg font-semibold">Something went wrong</p>
          <pre className="mt-3 max-w-lg whitespace-pre-wrap font-mono text-xs text-rose-300">{this.state.error.message}</pre>
        </Centered>
      );
    }
    return this.props.children;
  }
}
