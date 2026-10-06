import { PGliteWorker } from "@electric-sql/pglite/worker";
import { rebuild } from "./schema";

const DATA_DIR = "idb://easycutz-demo";

let pg: PGliteWorker | null = null;

export async function startDatabase(): Promise<PGliteWorker> {
  if (pg) return pg;
  pg = await PGliteWorker.create(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }), {
    dataDir: DATA_DIR,
    meta: { dataDir: DATA_DIR },
  });
  return pg;
}

export function db(): PGliteWorker {
  if (!pg) throw new Error("Demo database not started");
  return pg;
}

/** Rebuilds this browser's demo database with fresh sample data. */
export async function resetDatabase(): Promise<void> {
  await rebuild(db());
  notifyChange();
}

// ---------------------------------------------------------------------------
// "Realtime": every write notifies subscribers in this tab and in other tabs.
// ---------------------------------------------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("easycutz-demo") : null;
channel?.addEventListener("message", () => emitLocal());

let pending: number | null = null;
function emitLocal(): void {
  if (pending !== null) return;
  pending = window.setTimeout(() => {
    pending = null;
    for (const l of [...listeners]) {
      try {
        l();
      } catch (err) {
        console.error("[demo] change listener failed", err);
      }
    }
  }, 30);
}

export function notifyChange(): void {
  emitLocal();
  channel?.postMessage("changed");
}

export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
