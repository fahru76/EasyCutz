/**
 * Puts a few walk-ins in today's queue so the live queue and Quick-Desk have
 * something to show. Uses the real booking SQL (issue_queue_ticket,
 * desk_call_next). Best effort: outside opening hours the shop is closed and
 * nothing is added.
 */
import { getBrowserSupabase } from "./fake/supabase";
import { db } from "./db/client";

const SAMPLE = [
  { name: "Hafiz", phone: "+60110000001", service: "skin-fade" },
  { name: "Wei Jie", phone: "+60110000002", service: "signature-cut" },
  { name: "Arjun", phone: "+60110000003", service: "beard-sculpt" },
  { name: "Daniel", phone: "+60110000004", service: "buzz-cut" },
];

export async function addSampleActivity(): Promise<void> {
  const today = await db().query<{ n: number }>(
    `select count(*)::int as n from public.queue_tickets
      where shop_day = (now() at time zone (select timezone from public.shop_settings where id = 1))::date`,
  );
  if ((today.rows[0]?.n ?? 0) > 0) return;

  const services = await db().query<{ id: string; slug: string }>("select id, slug from public.services");
  const bySlug = new Map(services.rows.map((s) => [s.slug, s.id]));
  const supabase = getBrowserSupabase();

  for (const s of SAMPLE) {
    const { error } = await supabase.rpc("issue_queue_ticket", {
      p_preferred_barber_id: null,
      p_service_ids: [bySlug.get(s.service)!],
      p_addon_ids: [],
      p_customer_name: s.name,
      p_phone: s.phone,
      p_email: null,
      p_payment_option: "cash_on_site",
      p_notes: null,
    } as never);
    if (error) return; // shop closed right now: leave the queue empty
  }

  // Seat the first customer with whoever is free, so a chair shows as busy.
  const barbers = await db().query<{ id: string }>(
    "select id from public.barbers where is_active and is_on_duty order by sort_order limit 1",
  );
  if (barbers.rows[0]) {
    await supabase.rpc("desk_call_next", { p_barber_id: barbers.rows[0].id } as never);
  }
}
