// One PGlite (Postgres compiled to WebAssembly) shared by every open demo tab.
// It runs the real EasyCutz migrations, so bookings, the queue and every desk
// action go through the same SQL functions as production.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { worker } from "@electric-sql/pglite/worker";
import { actAsDemoOwner, rebuild, SCHEMA_VERSION } from "./schema";

worker({
  async init(options) {
    const dataDir = (options.meta as { dataDir?: string } | undefined)?.dataDir ?? "memory://";
    // relaxedDurability: flush to IndexedDB in the background instead of after every query.
    const db = await PGlite.create({ dataDir, relaxedDurability: true, extensions: { btree_gist } });
    if (await isReady(db)) await actAsDemoOwner(db);
    else await rebuild(db);
    return db;
  },
});

async function isReady(db: PGlite): Promise<boolean> {
  try {
    const r = await db.query<{ version: string }>("select version from demo_meta.info limit 1");
    return r.rows[0]?.version === SCHEMA_VERSION;
  } catch {
    return false;
  }
}
