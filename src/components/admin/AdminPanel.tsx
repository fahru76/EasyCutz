"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUp, Coffee, History, Pencil, Plus, Save, Scissors, Settings2, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { computeAmountDueNow } from "@/lib/cart";
import { cn, formatDuration, formatMoney } from "@/lib/format";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import type { Json, TableRow } from "@/lib/types/database";
import { SERVICE_CATEGORIES, type ServiceCategory } from "@/lib/types/domain";
import { SiteHeader } from "../ui/SiteHeader";
import { Badge, Button, Card, Field, Switch, inputClass } from "../ui/primitives";

type ServiceRow = TableRow<"services">;
type AddonRow = TableRow<"addons">;
type SettingsRow = TableRow<"shop_settings">;
type ChangeRow = TableRow<"catalog_changes">;
type BarberRow = Pick<TableRow<"barbers">, "id" | "display_name" | "sort_order">;
type BreakRow = TableRow<"barber_breaks">;

type Tab = "services" | "addons" | "breaks" | "fees" | "log";

const ERROR_TEXT: Record<string, string> = {
  forbidden: "Only the shop owner can change the menu and fees.",
  invalid_value: "One of the values is out of range. Check durations (1–240 min), prices (≥ RM 0) and percentages (1–100).",
  not_found: "That item no longer exists — refresh the page.",
  invalid_action: "That action isn't allowed.",
};
const errorText = (code: string) => ERROR_TEXT[code] ?? `Couldn't save (${code}).`;

/** "45" | "45.5" -> 4500 | 4550 ; null when invalid */
function parseRinggit(value: string): number | null {
  const v = value.trim().replace(/^RM\s*/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number.parseFloat(v) * 100);
}
const toRinggit = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

export function AdminPanel({
  services,
  addons,
  settings,
  changes,
  barbers,
  breaks,
  ownerName,
}: {
  services: ServiceRow[];
  addons: AddonRow[];
  settings: SettingsRow;
  changes: ChangeRow[];
  barbers: BarberRow[];
  breaks: BreakRow[];
  ownerName: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("services");
  const [toast, setToast] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, okText: string): Promise<boolean> {
    const { error } = await fn();
    if (error) {
      setToast({ tone: "error", text: errorText(error.message) });
      return false;
    }
    setToast({ tone: "ok", text: okText });
    router.refresh();
    return true;
  }

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "services", label: "Services", icon: <Scissors className="size-4" /> },
    { id: "addons", label: "Add-ons", icon: <Sparkles className="size-4" /> },
    { id: "breaks", label: "Breaks", icon: <Coffee className="size-4" /> },
    { id: "fees", label: "Fees & rules", icon: <Settings2 className="size-4" /> },
    { id: "log", label: "Change log", icon: <History className="size-4" /> },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        wide
        shopName={settings.shop_name}
        right={<span className="hidden text-sm text-zinc-400 sm:inline">{ownerName} · Owner</span>}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/desk" className="mb-2 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
              <ArrowLeft className="size-3" /> Quick-Desk
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500">Admin</p>
            <h1 className="text-2xl font-bold tracking-tight">Menu, prices & fees</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Changes go live on the booking page immediately. Existing bookings keep the price they were booked at.
            </p>
          </div>
        </div>

        <LayoutGroup id="admin-tabs">
          <div role="tablist" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
                  tab === t.id ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {tab === t.id && (
                  <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-full bg-amber-500" />
                )}
                <span className="relative flex items-center gap-2">
                  {t.icon}
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </LayoutGroup>

        {tab === "services" && <ServicesTab services={services} currency={settings.currency} run={run} />}
        {tab === "addons" && <AddonsTab addons={addons} currency={settings.currency} run={run} />}
        {tab === "breaks" && <BreaksTab barbers={barbers} breaks={breaks} run={run} />}
        {tab === "fees" && <FeesTab settings={settings} run={run} />}
        {tab === "log" && <LogTab changes={changes} timezone={settings.timezone} currency={settings.currency} />}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn(
              "fixed inset-x-4 bottom-6 z-50 mx-auto max-w-md rounded-2xl border glass-strong p-4 text-center text-sm shadow-2xl",
              toast.tone === "ok" ? "border-emerald-500/40 text-emerald-200" : "border-rose-500/40 text-rose-200",
            )}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type Runner = (fn: () => PromiseLike<{ error: { message: string } | null }>, okText: string) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
interface ItemDraft {
  id: string | null;
  name: string;
  description: string;
  category: ServiceCategory;
  duration: string;
  price: string;
  isPopular: boolean;
  isActive: boolean;
}

function draftFromService(s: ServiceRow | null, category: ServiceCategory = "haircut"): ItemDraft {
  return s
    ? {
        id: s.id, name: s.name, description: s.description, category: s.category,
        duration: String(s.duration_min), price: toRinggit(s.price_cents), isPopular: s.is_popular, isActive: s.is_active,
      }
    : { id: null, name: "", description: "", category, duration: "40", price: "", isPopular: false, isActive: true };
}

function validateDraft(d: ItemDraft, minDuration: number): string | null {
  if (d.name.trim().length < 2) return "Enter a name.";
  const dur = Number(d.duration);
  if (!Number.isInteger(dur) || dur < minDuration || dur > 240) return `Duration must be ${minDuration}–240 minutes.`;
  if (parseRinggit(d.price) === null) return "Enter a price like 45 or 45.50.";
  return null;
}

function ServicesTab({ services, currency, run }: { services: ServiceRow[]; currency: string; run: Runner }) {
  const [editing, setEditing] = useState<ItemDraft | null>(null);
  const db = getBrowserSupabase();

  async function save(d: ItemDraft) {
    const ok = await run(
      () =>
        db.rpc("admin_save_service", {
          p_id: d.id,
          p_name: d.name.trim(),
          p_description: d.description.trim(),
          p_category: d.category,
          p_duration_min: Number(d.duration),
          p_price_cents: parseRinggit(d.price) ?? 0,
          p_is_popular: d.isPopular,
          p_is_active: d.isActive,
        }),
      d.id ? `Saved “${d.name.trim()}”` : `Added “${d.name.trim()}”`,
    );
    if (ok) setEditing(null);
  }

  function move(list: ServiceRow[], index: number, dir: -1 | 1) {
    const next = [...list];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + dir, 0, item);
    void run(() => db.rpc("admin_reorder", { p_table: "services", p_ids: next.map((s) => s.id) }), "Order updated");
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(draftFromService(null))}>
          <Plus className="size-4" /> Add service
        </Button>
      </div>
      <AnimatePresence>
        {editing && editing.id === null && (
          <ItemForm key="new" draft={editing} kind="service" onCancel={() => setEditing(null)} onSave={save} />
        )}
      </AnimatePresence>

      {SERVICE_CATEGORIES.map((cat) => {
        const list = services.filter((s) => s.category === cat.id).sort((a, b) => a.sort_order - b.sort_order);
        if (list.length === 0) return null;
        return (
          <section key={cat.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">{cat.label}</h2>
            <Card className="divide-y divide-zinc-800/70">
              {list.map((s, i) =>
                editing?.id === s.id ? (
                  <div key={s.id} className="p-3">
                    <ItemForm draft={editing} kind="service" onCancel={() => setEditing(null)} onSave={save} />
                  </div>
                ) : (
                  <ItemRow
                    key={s.id}
                    name={s.name}
                    description={s.description}
                    meta={
                      <>
                        <Badge mono tone={s.is_active ? "amber" : "zinc"}>{formatMoney(s.price_cents, currency)}</Badge>
                        <Badge mono>{formatDuration(s.duration_min)}</Badge>
                        {s.is_popular && <Badge tone="amber">Popular</Badge>}
                        {!s.is_active && <Badge tone="rose">Hidden</Badge>}
                      </>
                    }
                    active={s.is_active}
                    onToggle={(on) => void save({ ...draftFromService(s), isActive: on })}
                    onEdit={() => setEditing(draftFromService(s))}
                    onUp={i > 0 ? () => move(list, i, -1) : undefined}
                    onDown={i < list.length - 1 ? () => move(list, i, 1) : undefined}
                  />
                ),
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------
function draftFromAddon(a: AddonRow | null): ItemDraft {
  return a
    ? {
        id: a.id, name: a.name, description: a.description, category: "haircut",
        duration: String(a.duration_min), price: toRinggit(a.price_cents), isPopular: false, isActive: a.is_active,
      }
    : { id: null, name: "", description: "", category: "haircut", duration: "5", price: "", isPopular: false, isActive: true };
}

function AddonsTab({ addons, currency, run }: { addons: AddonRow[]; currency: string; run: Runner }) {
  const [editing, setEditing] = useState<ItemDraft | null>(null);
  const db = getBrowserSupabase();
  const list = useMemo(() => [...addons].sort((a, b) => a.sort_order - b.sort_order), [addons]);

  async function save(d: ItemDraft) {
    const ok = await run(
      () =>
        db.rpc("admin_save_addon", {
          p_id: d.id,
          p_name: d.name.trim(),
          p_description: d.description.trim(),
          p_duration_min: Number(d.duration),
          p_price_cents: parseRinggit(d.price) ?? 0,
          p_is_active: d.isActive,
        }),
      d.id ? `Saved “${d.name.trim()}”` : `Added “${d.name.trim()}”`,
    );
    if (ok) setEditing(null);
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...list];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + dir, 0, item);
    void run(() => db.rpc("admin_reorder", { p_table: "addons", p_ids: next.map((a) => a.id) }), "Order updated");
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(draftFromAddon(null))}>
          <Plus className="size-4" /> Add add-on
        </Button>
      </div>
      <AnimatePresence>
        {editing && editing.id === null && (
          <ItemForm key="new" draft={editing} kind="addon" onCancel={() => setEditing(null)} onSave={save} />
        )}
      </AnimatePresence>
      <Card className="divide-y divide-zinc-800/70">
        {list.map((a, i) =>
          editing?.id === a.id ? (
            <div key={a.id} className="p-3">
              <ItemForm draft={editing} kind="addon" onCancel={() => setEditing(null)} onSave={save} />
            </div>
          ) : (
            <ItemRow
              key={a.id}
              name={a.name}
              description={a.description}
              meta={
                <>
                  <Badge mono tone={a.is_active ? "amber" : "zinc"}>+{formatMoney(a.price_cents, currency)}</Badge>
                  <Badge mono>+{a.duration_min}m</Badge>
                  {!a.is_active && <Badge tone="rose">Hidden</Badge>}
                </>
              }
              active={a.is_active}
              onToggle={(on) => void save({ ...draftFromAddon(a), isActive: on })}
              onEdit={() => setEditing(draftFromAddon(a))}
              onUp={i > 0 ? () => move(i, -1) : undefined}
              onDown={i < list.length - 1 ? () => move(i, 1) : undefined}
            />
          ),
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared row + form
// ---------------------------------------------------------------------------
function ItemRow({
  name,
  description,
  meta,
  active,
  onToggle,
  onEdit,
  onUp,
  onDown,
}: {
  name: string;
  description: string;
  meta: ReactNode;
  active: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-3 p-4", !active && "opacity-60")}>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-label={`Move ${name} up`}
          disabled={!onUp}
          onClick={onUp}
          className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200 disabled:opacity-20"
        >
          <ArrowUp className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`Move ${name} down`}
          disabled={!onDown}
          onClick={onDown}
          className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200 disabled:opacity-20"
        >
          <ArrowDown className="size-4" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-zinc-100">{name}</p>
        {description && <p className="truncate text-xs text-zinc-500">{description}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">{meta}</div>
      </div>
      <Switch checked={active} onChange={onToggle} label={`${name} visible on menu`} />
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name}`}
        className="flex size-10 items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:border-white/15"
      >
        <Pencil className="size-4" />
      </button>
    </div>
  );
}

function ItemForm({
  draft,
  kind,
  onCancel,
  onSave,
}: {
  draft: ItemDraft;
  kind: "service" | "addon";
  onCancel: () => void;
  onSave: (d: ItemDraft) => Promise<void>;
}) {
  const [d, setD] = useState<ItemDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const minDuration = kind === "service" ? 1 : 0;
  const idp = d.id ?? "new";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateDraft(d, minDuration);
    setError(problem);
    if (problem) return;
    setSaving(true);
    await onSave(d);
    setSaving(false);
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onSubmit={submit}
      className="space-y-4 rounded-2xl border border-amber-500/40 glass p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`name-${idp}`}>
          <input id={`name-${idp}`} className={inputClass} value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        {kind === "service" && (
          <Field label="Category" htmlFor={`cat-${idp}`}>
            <select
              id={`cat-${idp}`}
              className={inputClass}
              value={d.category}
              onChange={(e) => setD({ ...d, category: e.target.value as ServiceCategory })}
            >
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Price (RM)" htmlFor={`price-${idp}`}>
          <input
            id={`price-${idp}`}
            inputMode="decimal"
            className={cn(inputClass, "font-mono")}
            placeholder="45"
            value={d.price}
            onChange={(e) => setD({ ...d, price: e.target.value })}
          />
        </Field>
        <Field label="Duration (minutes)" hint={kind === "addon" ? "0 if it adds no time" : undefined} htmlFor={`dur-${idp}`}>
          <input
            id={`dur-${idp}`}
            inputMode="numeric"
            className={cn(inputClass, "font-mono")}
            value={d.duration}
            onChange={(e) => setD({ ...d, duration: e.target.value.replace(/[^\d]/g, "") })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" hint="Shown on the menu" htmlFor={`desc-${idp}`}>
            <input
              id={`desc-${idp}`}
              className={inputClass}
              maxLength={200}
              value={d.description}
              onChange={(e) => setD({ ...d, description: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm text-zinc-300">
        <label className="flex items-center gap-2">
          <Switch checked={d.isActive} onChange={(on) => setD({ ...d, isActive: on })} label="Visible on menu" /> Visible on menu
        </label>
        {kind === "service" && (
          <label className="flex items-center gap-2">
            <Switch checked={d.isPopular} onChange={(on) => setD({ ...d, isPopular: on })} label="Popular badge" /> Popular badge
          </label>
        )}
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X className="size-4" /> Cancel
        </Button>
        <Button type="submit" loading={saving}>
          <Save className="size-4" /> {d.id ? "Save changes" : kind === "service" ? "Add service" : "Add add-on"}
        </Button>
      </div>
    </motion.form>
  );
}

// ---------------------------------------------------------------------------
// Breaks (EZ-003)
// ---------------------------------------------------------------------------
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (t: string) => t.slice(0, 5);
const TIME_RE = /^\d{2}:\d{2}$/;

function BreaksTab({ barbers, breaks, run }: { barbers: BarberRow[]; breaks: BreakRow[]; run: Runner }) {
  const db = getBrowserSupabase();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const byBarber = (id: string) =>
    breaks
      .filter((b) => b.barber_id === id)
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-400">
          Recurring breaks are never offered as booking times, and live wait times flow around them. For a one-off
          break, use the break buttons on the Quick-Desk.
        </p>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add break
          </Button>
        )}
      </div>

      <AnimatePresence>
        {adding && (
          <BreakForm
            barbers={barbers}
            initial={null}
            onCancel={() => setAdding(false)}
            onSave={async (d) => {
              for (const weekday of d.weekdays) {
                const ok = await run(
                  () =>
                    db.rpc("admin_save_break", {
                      p_id: null,
                      p_barber_id: d.barberId,
                      p_weekday: weekday,
                      p_start_time: d.start,
                      p_end_time: d.end,
                      p_label: d.label,
                    }),
                  `Break added for ${d.weekdays.length} day${d.weekdays.length === 1 ? "" : "s"}`,
                );
                if (!ok) return;
              }
              setAdding(false);
            }}
          />
        )}
      </AnimatePresence>

      {barbers.map((barber) => {
        const rows = byBarber(barber.id);
        return (
          <Card key={barber.id} className="overflow-hidden">
            <p className="border-b border-white/10 px-4 py-3 font-semibold">{barber.display_name}</p>
            {rows.length === 0 && <p className="p-4 text-sm text-zinc-500">No recurring breaks.</p>}
            <ul className="divide-y divide-zinc-800/70">
              {rows.map((b) =>
                editing === b.id ? (
                  <li key={b.id} className="p-3">
                    <BreakForm
                      barbers={barbers}
                      initial={b}
                      onCancel={() => setEditing(null)}
                      onSave={async (d) => {
                        const ok = await run(
                          () =>
                            db.rpc("admin_save_break", {
                              p_id: b.id,
                              p_barber_id: d.barberId,
                              p_weekday: d.weekdays[0] ?? b.weekday,
                              p_start_time: d.start,
                              p_end_time: d.end,
                              p_label: d.label,
                            }),
                          "Break updated",
                        );
                        if (ok) setEditing(null);
                      }}
                    />
                  </li>
                ) : (
                  <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-10 font-mono text-xs font-semibold uppercase text-amber-400">{WEEKDAYS[b.weekday]}</span>
                    <span className="font-mono text-sm text-zinc-200">
                      {hhmm(b.start_time)}–{hhmm(b.end_time)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{b.label}</span>
                    <button
                      type="button"
                      aria-label={`Edit ${b.label} on ${WEEKDAYS[b.weekday]}`}
                      onClick={() => setEditing(b.id)}
                      className="text-zinc-500 hover:text-zinc-200"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <RemoveBreakButton
                      label={`${b.label} on ${WEEKDAYS[b.weekday]}`}
                      onConfirm={() => void run(() => db.rpc("admin_delete_break", { p_id: b.id }), "Break removed")}
                    />
                  </li>
                ),
              )}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function RemoveBreakButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <button type="button" onClick={onConfirm} className="text-xs font-semibold text-rose-300 hover:underline">
      Remove?
    </button>
  ) : (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      onClick={() => setArmed(true)}
      className="text-zinc-500 hover:text-rose-300"
    >
      <Trash2 className="size-4" />
    </button>
  );
}

interface BreakDraft {
  barberId: string;
  weekdays: number[];
  start: string;
  end: string;
  label: string;
}

function BreakForm({
  barbers,
  initial,
  onCancel,
  onSave,
}: {
  barbers: BarberRow[];
  initial: BreakRow | null;
  onCancel: () => void;
  onSave: (d: BreakDraft) => Promise<void>;
}) {
  const [d, setD] = useState<BreakDraft>(() =>
    initial
      ? {
          barberId: initial.barber_id,
          weekdays: [initial.weekday],
          start: hhmm(initial.start_time),
          end: hhmm(initial.end_time),
          label: initial.label,
        }
      : { barberId: barbers[0]?.id ?? "", weekdays: [0, 2, 3, 4, 6], start: "13:00", end: "13:45", label: "Lunch" },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fid = initial?.id ?? "new";
  const toggleDay = (day: number) =>
    setD((x) => ({
      ...x,
      weekdays: initial
        ? [day]
        : x.weekdays.includes(day)
          ? x.weekdays.filter((w) => w !== day)
          : [...x.weekdays, day].sort((a, b) => a - b),
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.barberId) return setError("Pick a barber.");
    if (d.weekdays.length === 0) return setError("Pick at least one day.");
    if (!TIME_RE.test(d.start) || !TIME_RE.test(d.end) || d.end <= d.start) {
      return setError("The end time must be after the start time.");
    }
    if (!d.label.trim() || d.label.trim().length > 40) return setError("Give the break a short name (max 40 characters).");
    setError(null);
    setSaving(true);
    await onSave({ ...d, label: d.label.trim() });
    setSaving(false);
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      onSubmit={submit}
      className="space-y-4 rounded-2xl border border-amber-500/30 glass p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Barber" htmlFor={`break-barber-${fid}`}>
          <select
            id={`break-barber-${fid}`}
            className={inputClass}
            value={d.barberId}
            onChange={(e) => setD({ ...d, barberId: e.target.value })}
          >
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" htmlFor={`break-label-${fid}`} hint="Shown to customers">
          <input
            id={`break-label-${fid}`}
            className={inputClass}
            value={d.label}
            maxLength={40}
            onChange={(e) => setD({ ...d, label: e.target.value })}
          />
        </Field>
        <Field label="From" htmlFor={`break-start-${fid}`}>
          <input
            id={`break-start-${fid}`}
            type="time"
            step={300}
            className={inputClass}
            value={d.start}
            onChange={(e) => setD({ ...d, start: e.target.value })}
          />
        </Field>
        <Field label="Until" htmlFor={`break-end-${fid}`}>
          <input
            id={`break-end-${fid}`}
            type="time"
            step={300}
            className={inputClass}
            value={d.end}
            onChange={(e) => setD({ ...d, end: e.target.value })}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-300">{initial ? "Day" : "Days"}</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((w, day) => (
            <button
              key={w}
              type="button"
              aria-pressed={d.weekdays.includes(day)}
              onClick={() => toggleDay(day)}
              className={cn(
                "w-12 rounded-lg border py-1.5 text-xs font-semibold",
                d.weekdays.includes(day) ? "border-amber-500 bg-amber-500 text-zinc-950" : "border-white/10 text-zinc-400",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X className="size-4" /> Cancel
        </Button>
        <Button type="submit" loading={saving}>
          <Save className="size-4" /> {initial ? "Save break" : "Add break"}
        </Button>
      </div>
    </motion.form>
  );
}

// ---------------------------------------------------------------------------
// Fees & rules
// ---------------------------------------------------------------------------
const NUMERIC_FIELDS: Array<{ key: keyof SettingsRow; label: string; hint: string; min: number; max: number }> = [
  { key: "deposit_percent", label: "Deposit (%)", hint: "Share of the total paid online", min: 1, max: 100 },
  { key: "hold_minutes", label: "Payment hold (minutes)", hint: "Min 30 (Stripe)", min: 30, max: 1440 },
  { key: "booking_horizon_days", label: "Book ahead (days)", hint: "How far ahead customers can book", min: 1, max: 90 },
  { key: "min_lead_min", label: "Minimum notice (minutes)", hint: "Earliest bookable time from now", min: 0, max: 1440 },
  { key: "notify_lead_min", label: "Turn-soon alert (minutes)", hint: "When the pass alerts the customer", min: 1, max: 60 },
  { key: "delay_notify_min", label: "Delay notice from (minutes)", hint: "Desk prompts a delay message", min: 1, max: 120 },
  { key: "early_offer_min", label: "Invite-early gap (minutes)", hint: "Free gap before suggesting early arrival", min: 1, max: 120 },
  { key: "reschedule_cutoff_min", label: "Self-reschedule cutoff (minutes)", hint: "Customers can move a booking until this long before", min: 0, max: 10080 },
  { key: "offer_hold_hours", label: "Hold proposed times (hours)", hint: "How long new times are held for a customer", min: 1, max: 168 },
  { key: "buffer_after_service_min", label: "Rest after each booking (minutes)", hint: "Kept free after every booking (0 = none)", min: 0, max: 30 },
];
const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60];

function FeesTab({ settings, run }: { settings: SettingsRow; run: Runner }) {
  const initial = useMemo(
    () => ({
      shop_name: settings.shop_name,
      shop_phone: settings.shop_phone ?? "",
      shop_address: settings.shop_address ?? "",
      min_deposit: toRinggit(settings.min_deposit_cents),
      slot_interval_min: String(settings.slot_interval_min),
      ...Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, String(settings[f.key] ?? "")])),
    }) as Record<string, string>,
    [settings],
  );
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const db = getBrowserSupabase();

  const depositPreview = computeAmountDueNow(5000, "deposit", {
    depositPercent: Number(form.deposit_percent) || settings.deposit_percent,
    minDepositCents: parseRinggit(form.min_deposit ?? "") ?? settings.min_deposit_cents,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, Json> = {};
    for (const f of NUMERIC_FIELDS) {
      const raw = form[f.key as string] ?? "";
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n < f.min || n > f.max) {
        setError(`${f.label} must be ${f.min}–${f.max}.`);
        return;
      }
      if (n !== settings[f.key]) patch[f.key as string] = n;
    }
    const minDeposit = parseRinggit(form.min_deposit ?? "");
    if (minDeposit === null || minDeposit < 200) {
      setError("Minimum deposit must be at least RM 2 (FPX minimum).");
      return;
    }
    if (minDeposit !== settings.min_deposit_cents) patch.min_deposit_cents = minDeposit;
    const interval = Number(form.slot_interval_min);
    if (interval !== settings.slot_interval_min) patch.slot_interval_min = interval;
    for (const key of ["shop_name", "shop_phone", "shop_address"] as const) {
      const before = (settings[key] ?? "") as string;
      if ((form[key] ?? "").trim() !== before) patch[key] = (form[key] ?? "").trim();
    }
    if (!(form.shop_name ?? "").trim()) {
      setError("Shop name can't be empty.");
      return;
    }
    if (Object.keys(patch).length === 0) {
      setError("Nothing changed.");
      return;
    }
    setError(null);
    setSaving(true);
    await run(() => db.rpc("admin_update_settings", { p_patch: patch }), "Fees & rules saved");
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Payments</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField f={NUMERIC_FIELDS[0]!} form={form} setForm={setForm} />
          <Field label="Minimum deposit (RM)" hint="≥ RM 2" htmlFor="min_deposit">
            <input
              id="min_deposit"
              inputMode="decimal"
              className={cn(inputClass, "font-mono")}
              value={form.min_deposit ?? ""}
              onChange={(e) => setForm({ ...form, min_deposit: e.target.value })}
            />
          </Field>
          <NumberField f={NUMERIC_FIELDS[1]!} form={form} setForm={setForm} />
        </div>
        <p className="font-mono text-xs text-zinc-500">
          Preview: deposit on a RM 50 booking = <span className="text-amber-400">{formatMoney(depositPreview)}</span>
        </p>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Booking rules</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField f={NUMERIC_FIELDS[2]!} form={form} setForm={setForm} />
          <NumberField f={NUMERIC_FIELDS[3]!} form={form} setForm={setForm} />
          <Field label="Time slot step" hint="Minutes between start times" htmlFor="slot_interval_min">
            <select
              id="slot_interval_min"
              className={inputClass}
              value={form.slot_interval_min}
              onChange={(e) => setForm({ ...form, slot_interval_min: e.target.value })}
            >
              {SLOT_INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Notifications</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField f={NUMERIC_FIELDS[4]!} form={form} setForm={setForm} />
          <NumberField f={NUMERIC_FIELDS[5]!} form={form} setForm={setForm} />
          <NumberField f={NUMERIC_FIELDS[6]!} form={form} setForm={setForm} />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Shop details</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {(["shop_name", "shop_phone", "shop_address"] as const).map((k) => (
            <Field key={k} label={k === "shop_name" ? "Shop name" : k === "shop_phone" ? "WhatsApp number" : "Address"} htmlFor={k}>
              <input id={k} className={inputClass} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Card>

      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={saving}>
          <Save className="size-5" /> Save fees & rules
        </Button>
      </div>
    </form>
  );
}

function NumberField({
  f,
  form,
  setForm,
}: {
  f: (typeof NUMERIC_FIELDS)[number];
  form: Record<string, string>;
  setForm: (next: Record<string, string>) => void;
}) {
  const key = f.key as string;
  return (
    <Field label={f.label} hint={f.hint} htmlFor={key}>
      <input
        id={key}
        inputMode="numeric"
        className={cn(inputClass, "font-mono")}
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value.replace(/[^\d]/g, "") })}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------
const WATCHED_KEYS = [
  "name", "price_cents", "duration_min", "is_active", "is_popular", "category",
  "deposit_percent", "min_deposit_cents", "hold_minutes", "booking_horizon_days", "min_lead_min",
  "slot_interval_min", "notify_lead_min", "delay_notify_min", "early_offer_min", "shop_name", "shop_phone", "shop_address",
  "reschedule_cutoff_min", "offer_hold_hours", "buffer_after_service_min",
  "weekday", "start_time", "end_time", "label",
];

function describeValue(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined) return "—";
  if ((key === "price_cents" || key === "min_deposit_cents") && typeof value === "number") return formatMoney(value, currency);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function LogTab({ changes, timezone, currency }: { changes: ChangeRow[]; timezone: string; currency: string }) {
  if (changes.length === 0) {
    return <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No changes yet.</p>;
  }
  const fmt = new Intl.DateTimeFormat("en-MY", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  return (
    <Card className="divide-y divide-zinc-800/70">
      {changes.map((c) => {
        const before = (c.before ?? {}) as Record<string, unknown>;
        const after = (c.after ?? {}) as Record<string, unknown>;
        const name = (after.name ?? before.name ?? after.label ?? before.label ?? (c.table_name === "shop_settings" ? "Fees & rules" : c.table_name)) as string;
        const diffs = WATCHED_KEYS.filter((k) => k in after && JSON.stringify(before[k]) !== JSON.stringify(after[k]) && c.action !== "create");
        return (
          <div key={c.id} className="p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.action === "deactivate" || c.action === "delete" ? "rose" : c.action === "create" ? "emerald" : "zinc"}>{c.action}</Badge>
              <span className="font-semibold text-zinc-100">{name}</span>
              <span className="text-xs text-zinc-500">{c.table_name === "shop_settings" ? "settings" : c.table_name === "barber_breaks" ? "breaks" : c.table_name}</span>
              <span className="ml-auto font-mono text-xs text-zinc-500">{fmt.format(new Date(c.changed_at))}</span>
            </div>
            {diffs.length > 0 && (
              <ul className="mt-2 space-y-0.5 font-mono text-xs text-zinc-400">
                {diffs.map((k) => (
                  <li key={k}>
                    {k}: <span className="text-zinc-500 line-through">{describeValue(k, before[k], currency)}</span> →{" "}
                    <span className="text-amber-300">{describeValue(k, after[k], currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </Card>
  );
}
