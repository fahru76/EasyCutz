/**
 * A small stand-in for the Supabase JS client, backed by the in-browser
 * Postgres (PGlite). It supports exactly the query-builder surface EasyCutz
 * uses: select/insert/update/delete, eq/neq/lt/lte/gt/gte/in/is/or, order,
 * limit, single/maybeSingle, rpc, realtime channels and a signed-in demo owner.
 *
 * Rows come back as Postgres JSON (json_agg), which is what PostgREST returns,
 * so the app's mappers see the same shapes as in production.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { db, notifyChange, onChange } from "../db/client";
import { DEMO_STAFF_ID } from "../db/schema";

type Row = Record<string, unknown>;
interface PgError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}
interface Result<T = unknown> {
  data: T;
  error: PgError | null;
  count: null;
  status: number;
  statusText: string;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
  /** Scalars go through as text; Postgres casts them to the column's type. */
  scalar(v: unknown): string {
    if (typeof v === "boolean" || typeof v === "number") return this.add(String(v));
    return this.add(v instanceof Date ? v.toISOString() : v);
  }
  list(v: unknown[]): string {
    return `array(select jsonb_array_elements_text(${this.add(JSON.stringify(v))}::jsonb))`;
  }
}

function toError(err: unknown): PgError {
  const e = err as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: e.message ?? String(err), code: e.code ?? "unknown", details: e.detail ?? null, hint: e.hint ?? null };
}

function ok<T>(data: T, status = 200): Result<T> {
  return { data, error: null, count: null, status, statusText: "OK" };
}
function fail(error: PgError, status = 400): Result<null> {
  return { data: null, error, count: null, status, statusText: "Error" };
}

type Filter = (p: Params) => string;
type Mode = "many" | "single" | "maybe";

class QueryBuilder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private returning = false;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private mode: Mode = "many";
  private payload: Row | Row[] | null = null;

  constructor(private readonly table: string) {}

  select(columns = "*"): this {
    this.columns = columns;
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: Row): this {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  private cmp(column: string, op: string, value: unknown): this {
    this.filters.push((p) => `${ident(column)} ${op} ${p.scalar(value)}`);
    return this;
  }
  eq(column: string, value: unknown): this {
    if (value === null) return this.is(column, null);
    return this.cmp(column, "=", value);
  }
  neq(column: string, value: unknown): this {
    return this.cmp(column, "<>", value);
  }
  lt(column: string, value: unknown): this {
    return this.cmp(column, "<", value);
  }
  lte(column: string, value: unknown): this {
    return this.cmp(column, "<=", value);
  }
  gt(column: string, value: unknown): this {
    return this.cmp(column, ">", value);
  }
  gte(column: string, value: unknown): this {
    return this.cmp(column, ">=", value);
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((p) => `${ident(column)}::text = any(${p.list(values.map(String))})`);
    return this;
  }
  is(column: string, value: null | boolean): this {
    this.filters.push(() => `${ident(column)} is ${value === null ? "null" : value ? "true" : "false"}`);
    return this;
  }
  /** PostgREST "or" syntax, e.g. `ticket_id.in.(a,b),appointment_id.eq.c`. */
  or(expression: string): this {
    const parts = splitTopLevel(expression);
    this.filters.push((p) => {
      const sql = parts.map((part) => {
        const [column, op, ...rest] = part.split(".");
        const value = rest.join(".");
        switch (op) {
          case "in":
            return `${ident(column)}::text = any(${p.list(value.replace(/^\(|\)$/g, "").split(",").filter(Boolean))})`;
          case "eq":
            return `${ident(column)}::text = ${p.add(value)}`;
          case "is":
            return `${ident(column)} is ${value === "null" ? "null" : value === "true" ? "true" : "false"}`;
          default:
            throw new Error(`Demo client: unsupported or() operator "${op}"`);
        }
      });
      return `(${sql.join(" or ") || "false"})`;
    });
    return this;
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    const dir = options.ascending === false ? "desc" : "asc";
    const nulls = options.nullsFirst === undefined ? "" : options.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`${ident(column)} ${dir}${nulls}`);
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.mode = "single";
    return this;
  }
  maybeSingle(): this {
    this.mode = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private columnList(): string {
    if (this.columns.trim() === "*") return "*";
    return this.columns
      .split(",")
      .map((c) => ident(c.trim()))
      .join(", ");
  }

  private where(p: Params): string {
    return this.filters.length ? ` where ${this.filters.map((f) => f(p)).join(" and ")}` : "";
  }

  private async execute(): Promise<Result> {
    const p = new Params();
    const table = `public.${ident(this.table)}`;
    const returning = ` returning ${this.returning ? this.columnList() : "1 as ok"}`;
    let inner: string;

    try {
      if (this.op === "select") {
        inner =
          `select ${this.columnList()} from ${table}${this.where(p)}` +
          (this.orders.length ? ` order by ${this.orders.join(", ")}` : "") +
          (this.limitN !== null ? ` limit ${Math.floor(this.limitN)}` : "");
      } else if (this.op === "insert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const colSql = cols.map(ident).join(", ");
        inner =
          `insert into ${table} (${colSql}) select ${colSql} ` +
          `from jsonb_populate_recordset(null::${table}, ${p.add(JSON.stringify(rows))}::jsonb)${returning}`;
      } else if (this.op === "update") {
        const cols = Object.keys(this.payload ?? {});
        const src = `jsonb_populate_record(null::${table}, ${p.add(JSON.stringify(this.payload))}::jsonb)`;
        const sets = cols.map((c) => `${ident(c)} = (select ${ident(c)} from ${src})`).join(", ");
        inner = `update ${table} set ${sets}${this.where(p)}${returning}`;
      } else {
        inner = `delete from ${table}${this.where(p)}${returning}`;
      }

      const sql =
        this.op === "select"
          ? `select coalesce(json_agg(t), '[]'::json) as data from (${inner}) t`
          : `with t as (${inner}) select coalesce(json_agg(t), '[]'::json) as data from t`;
      const res = await db().query<{ data: Row[] }>(sql, p.values);
      const rows = res.rows[0]?.data ?? [];
      if (this.op !== "select") notifyChange();

      const data = this.op !== "select" && !this.returning ? null : rows;
      if (this.mode === "many" || data === null) return ok(data, this.op === "insert" ? 201 : 200);
      if (rows.length > 1 || (this.mode === "single" && rows.length === 0)) {
        return fail(
          { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: null, hint: null },
          406,
        );
      }
      return ok(rows[0] ?? null);
    } catch (err) {
      return fail(toError(err));
    }
  }
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// RPC: call public functions with named arguments, typed from pg_catalog.
// ---------------------------------------------------------------------------
interface FnInfo {
  args: Array<{ name: string; type: string }>;
  returnsSet: boolean;
  composite: boolean;
  isVoid: boolean;
  volatile: boolean;
}
let catalog: Promise<Map<string, FnInfo[]>> | null = null;

/** Forget cached function signatures (after the demo database is rebuilt). */
export function resetCatalog(): void {
  catalog = null;
}

function loadCatalog(): Promise<Map<string, FnInfo[]>> {
  catalog ??= db()
    .query<{
      name: string;
      argnames: string[] | null;
      argmodes: string[] | null;
      alltypes: string[] | null;
      intypes: string[];
      returns_set: boolean;
      typtype: string;
      is_void: boolean;
      volatile: boolean;
    }>(
      `select p.proname as name, p.proargnames as argnames, p.proargmodes::text[] as argmodes,
              case when p.proallargtypes is null then null
                   else array(select format_type(x, null) from unnest(p.proallargtypes) x) end as alltypes,
              array(select format_type(x, null) from unnest(p.proargtypes::oid[]) x) as intypes,
              p.proretset as returns_set, rt.typtype::text as typtype,
              p.prorettype = 'void'::regtype as is_void, p.provolatile = 'v' as volatile
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_type rt on rt.oid = p.prorettype
        where n.nspname = 'public'`,
    )
    .then((res) => {
      const map = new Map<string, FnInfo[]>();
      for (const r of res.rows) {
        const names = r.argnames ?? [];
        const args: FnInfo["args"] = [];
        if (!r.argmodes) {
          r.intypes.forEach((type, i) => args.push({ name: names[i] ?? `$${i + 1}`, type }));
        } else {
          r.argmodes.forEach((m, i) => {
            if (m === "i" || m === "b" || m === "v") args.push({ name: names[i], type: (r.alltypes ?? [])[i] });
          });
        }
        const info: FnInfo = {
          args,
          returnsSet: r.returns_set,
          composite: r.typtype === "c",
          isVoid: r.is_void,
          volatile: r.volatile,
        };
        map.set(r.name, [...(map.get(r.name) ?? []), info]);
      }
      return map;
    });
  return catalog;
}

async function rpc(fn: string, args: Row = {}): Promise<Result> {
  try {
    const overloads = (await loadCatalog()).get(fn);
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    const info = overloads?.find((o) => keys.every((k) => o.args.some((a) => a.name === k)));
    if (!info) throw Object.assign(new Error(`function public.${fn} not found`), { code: "PGRST202" });

    const p = new Params();
    // Only bind the argument object when it is used (Postgres rejects unused parameters).
    const json = keys.length ? `${p.add(JSON.stringify(args))}::jsonb` : "";
    const argSql = keys
      .map((k) => {
        const type = info.args.find((a) => a.name === k)!.type;
        const key = k.replace(/'/g, "''");
        let value: string;
        if (type.endsWith("[]")) {
          value =
            `(case when jsonb_typeof(${json} -> '${key}') = 'array' ` +
            `then array(select jsonb_array_elements_text(${json} -> '${key}')) end)::${type}`;
        } else if (type === "jsonb" || type === "json") {
          value = `(${json} -> '${key}')::${type}`;
        } else {
          value = `(${json} ->> '${key}')::${type}`;
        }
        return `${ident(k)} => ${value}`;
      })
      .join(", ");
    const call = `public.${ident(fn)}(${argSql})`;

    let data: unknown;
    if (info.isVoid) {
      await db().query(`select ${call}`, p.values);
      data = null;
    } else if (info.returnsSet || info.composite) {
      const res = await db().query<{ data: Row[] }>(
        `select coalesce(json_agg(t), '[]'::json) as data from ${call} t`,
        p.values,
      );
      const rows = res.rows[0]?.data ?? [];
      data = info.returnsSet ? rows : (rows[0] ?? null);
    } else {
      const res = await db().query<{ data: unknown }>(`select to_json(${call}) as data`, p.values);
      data = res.rows[0]?.data ?? null;
    }
    if (info.volatile) notifyChange();
    return ok(data);
  } catch (err) {
    return fail(toError(err));
  }
}

// ---------------------------------------------------------------------------
// Realtime + auth
// ---------------------------------------------------------------------------
class DemoChannel {
  private handlers: Array<(payload: unknown) => void> = [];
  private off: (() => void) | null = null;
  on(_event: string, _filter: unknown, handler: (payload: unknown) => void): this {
    this.handlers.push(handler);
    return this;
  }
  subscribe(callback?: (status: string, err?: Error) => void): this {
    this.off = onChange(() => this.handlers.forEach((h) => h({ eventType: "*", new: {}, old: {} })));
    window.setTimeout(() => callback?.("SUBSCRIBED"), 0);
    return this;
  }
  unsubscribe(): Promise<"ok"> {
    this.off?.();
    this.off = null;
    return Promise.resolve("ok");
  }
}

const SIGNED_OUT_KEY = "easycutz-demo-signed-out";
function signedOut(): boolean {
  try {
    return sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}
function setSignedOut(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(SIGNED_OUT_KEY, "1");
    else sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // storage blocked: stay signed in
  }
}

const demoUser = {
  id: DEMO_STAFF_ID,
  email: "owner@demo.easycutz",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
};

const auth = {
  async getUser() {
    return signedOut()
      ? { data: { user: null }, error: { message: "Auth session missing!", name: "AuthSessionMissingError" } }
      : { data: { user: demoUser }, error: null };
  },
  async getClaims() {
    return signedOut()
      ? { data: null, error: null }
      : { data: { claims: { sub: DEMO_STAFF_ID, email: demoUser.email } }, error: null };
  },
  async getSession() {
    return { data: { session: signedOut() ? null : { user: demoUser } }, error: null };
  },
  async signInWithPassword() {
    setSignedOut(false);
    return { data: { user: demoUser, session: { user: demoUser } }, error: null };
  },
  async signOut() {
    setSignedOut(true);
    return { error: null };
  },
  onAuthStateChange() {
    return { data: { subscription: { unsubscribe() {} } } };
  },
};

const client = {
  from: (table: string) => new QueryBuilder(table),
  rpc: (fn: string, args?: Row) => {
    const promise = rpc(fn, args);
    return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
  },
  channel: () => new DemoChannel(),
  removeChannel: (ch: DemoChannel) => ch.unsubscribe(),
  auth,
};

const typed = client as unknown as SupabaseClient<Database>;

/** Replaces src/lib/supabase/browser.ts */
export function getBrowserSupabase(): SupabaseClient<Database> {
  return typed;
}
/** Replaces src/lib/supabase/admin.ts */
export function getAdminSupabase(): SupabaseClient<Database> {
  return typed;
}
/** Replaces src/lib/supabase/server.ts */
export async function getServerSupabase(): Promise<SupabaseClient<Database>> {
  return typed;
}
