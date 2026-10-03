-- =============================================================================
-- EasyCutz — Row Level Security, grants and Realtime
-- =============================================================================

alter table public.shop_settings   enable row level security;
alter table public.services        enable row level security;
alter table public.addons          enable row level security;
alter table public.barbers         enable row level security;
alter table public.barber_shifts   enable row level security;
alter table public.barber_time_off enable row level security;
alter table public.staff           enable row level security;
alter table public.appointments    enable row level security;
alter table public.queue_tickets   enable row level security;
alter table public.booking_private enable row level security;
alter table public.payments        enable row level security;

-- ---------------------------------------------------------------------------
-- Public read-only catalog / roster
-- ---------------------------------------------------------------------------
create policy "settings readable by everyone" on public.shop_settings
  for select to anon, authenticated using (true);

create policy "active services readable" on public.services
  for select to anon, authenticated using (is_active or public.is_staff());

create policy "active addons readable" on public.addons
  for select to anon, authenticated using (is_active or public.is_staff());

create policy "active barbers readable" on public.barbers
  for select to anon, authenticated using (is_active or public.is_staff());

create policy "shifts readable" on public.barber_shifts
  for select to anon, authenticated using (true);

create policy "time off readable" on public.barber_time_off
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Live board data (no contact details live in these tables).
-- Anonymous visitors may read the current window so wait times and queue
-- positions stream through Realtime. All writes go through RPCs.
-- ---------------------------------------------------------------------------
create policy "recent appointments readable" on public.appointments
  for select to anon, authenticated
  using (starts_at >= now() - interval '1 day' or public.is_staff());

create policy "recent tickets readable" on public.queue_tickets
  for select to anon, authenticated
  using (shop_day >= public.shop_today() - 1 or public.is_staff());

-- ---------------------------------------------------------------------------
-- Staff-only data
-- ---------------------------------------------------------------------------
create policy "staff read staff rows" on public.staff
  for select to authenticated using (user_id = auth.uid() or public.is_staff());

create policy "staff read contacts" on public.booking_private
  for select to authenticated using (public.is_staff());

create policy "staff read payments" on public.payments
  for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Table privileges: read-only for client roles (RLS still applies).
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke select on public.booking_private, public.payments, public.staff from anon;

-- ---------------------------------------------------------------------------
-- Function privileges
--   * Booking / payment RPCs: service_role only (called from Next.js API
--     routes after zod validation and rate limiting).
--   * Desk RPCs: authenticated (each one asserts is_staff()).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.shop_tz()                to anon, authenticated, service_role;
grant execute on function public.shop_today()             to anon, authenticated, service_role;
grant execute on function public.is_staff()               to anon, authenticated, service_role;
grant execute on function public.make_display_name(text)  to anon, authenticated, service_role;
grant execute on function public.touch_updated_at()       to service_role;

grant execute on function public.price_cart(uuid[], uuid[])                     to service_role;
grant execute on function public.amount_due_now(integer, public.payment_option) to service_role;
grant execute on function public.expire_stale_holds()                           to service_role;
grant execute on function public.issue_queue_ticket(uuid, uuid[], uuid[], text, text, text, public.payment_option, text) to service_role;
grant execute on function public.book_appointment(uuid, timestamptz, uuid[], uuid[], text, text, text, public.payment_option, text) to service_role;
grant execute on function public.cancel_booking(uuid)                           to service_role;
grant execute on function public.apply_checkout_result(text, boolean, text)     to service_role;

grant execute on function public.assert_staff()                                 to authenticated, service_role;
grant execute on function public.chair_is_busy(uuid, uuid)                      to authenticated, service_role;
grant execute on function public.desk_call_next(uuid)                           to authenticated;
grant execute on function public.desk_transition(public.booking_kind, uuid, text, uuid) to authenticated;
grant execute on function public.desk_check_in(uuid)                            to authenticated;
grant execute on function public.desk_mark_notified(uuid)                       to authenticated;
grant execute on function public.desk_set_duty(uuid, boolean)                   to authenticated;

-- Functions created later are not callable by anon unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime: stream live queue, bookings and barber duty changes
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table public.queue_tickets;
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.barbers;
