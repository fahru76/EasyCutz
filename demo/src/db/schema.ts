// The real migrations + seed, bundled as text so the demo runs the same SQL as production.
import stubs from "../../../supabase/tests/local_stubs.sql?raw";
import seed from "../../../supabase/seed.sql?raw";

const migrations = import.meta.glob("../../../supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const DEMO_STAFF_ID = "00000000-0000-4000-8000-00000000d3e0";

const migrationText = Object.keys(migrations)
  .sort()
  .map((k) => migrations[k]);

/** Changes whenever the bundled SQL changes, so returning visitors get a fresh database. */
export const SCHEMA_VERSION = String(hash([stubs, ...migrationText, seed].join("\n")));

export const bootstrapSql: string[] = [
  stubs,
  ...migrationText,
  seed,
  `insert into auth.users (id, email) values ('${DEMO_STAFF_ID}', 'owner@demo.easycutz')
     on conflict do nothing;
   insert into public.staff (user_id, role, display_name) values ('${DEMO_STAFF_ID}', 'owner', 'Demo Owner')
     on conflict do nothing;`,
  // Demo only: keep the shop open around the clock, every day, so the live queue
  // and Quick-Desk can be tried at any hour. Lunch and prayer breaks stay as seeded.
  `delete from public.barber_shifts;
   insert into public.barber_shifts (barber_id, weekday, start_time, end_time)
   select b.id, d.weekday, time '00:00', time '23:59'
     from public.barbers b
     cross join generate_series(0, 6) as d(weekday);`,
];

interface SqlRunner {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** Fresh schema + sample data (first visit, new release, or "Reset demo"). Browser-local only. */
export async function rebuild(db: SqlRunner): Promise<void> {
  await db.exec(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists demo_meta cascade;
    create schema public;
    grant all on schema public to public;
  `);
  for (const sql of bootstrapSql) await db.exec(sql);
  await db.exec("create schema demo_meta; create table demo_meta.info (version text not null);");
  await db.query("insert into demo_meta.info (version) values ($1)", [SCHEMA_VERSION]);
  await actAsDemoOwner(db);
}

/** Every desk RPC checks auth.uid(): act as the demo owner on this connection. */
export async function actAsDemoOwner(db: SqlRunner): Promise<void> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [DEMO_STAFF_ID]);
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
