-- =============================================================================
-- EasyCutz — EZ-003 barber rest time
--
-- * barber_breaks: recurring weekly breaks (lunch, Friday prayers, …), shop-local
--   times. Public read (no personal data) so the live estimator can use them.
-- * barber_time_off.kind = 'break': ad-hoc "Take a break" from the desk.
-- * shop_settings.buffer_after_service_min: optional rest/cleanup gap kept free
--   after every booking (default 0).
-- * slot_conflict (bookings, reschedules, offers) refuses windows that overlap
--   a recurring break and keeps the buffer between bookings.
-- * desk_call_next refuses to call for a barber who is on a break, and walk-ins
--   are only called when they fit before the next booking OR the next break.
-- =============================================================================

alter table public.shop_settings
  add column if not exists buffer_after_service_min integer not null default 0
    check (buffer_after_service_min between 0 and 30);

alter table public.barber_time_off
  add column if not exists kind text not null default 'time_off' check (kind in ('time_off', 'break'));

create table public.barber_breaks (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.barbers(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  label      text not null default 'Break' check (length(label) between 1 and 40),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index barber_breaks_barber_weekday_idx on public.barber_breaks (barber_id, weekday);

alter table public.barber_breaks enable row level security;
create policy "breaks readable" on public.barber_breaks for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.barber_breaks from anon, authenticated;
grant select on public.barber_breaks to anon, authenticated;

-- Audit: breaks are edited by the owner like the menu.
do $$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.catalog_changes'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) like '%table_name%' or pg_get_constraintdef(oid) like '%action%')
  loop
    execute format('alter table public.catalog_changes drop constraint %I', v_name);
  end loop;
end $$;
alter table public.catalog_changes
  add constraint catalog_changes_table_name_check
    check (table_name in ('services', 'addons', 'shop_settings', 'barber_breaks')),
  add constraint catalog_changes_action_check
    check (action in ('create', 'update', 'activate', 'deactivate', 'reorder', 'delete'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Label of a recurring break overlapping [p_starts_at, p_ends_at) on the start's local date.
create or replace function public.break_overlapping(p_barber_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b.label
    from public.barber_breaks b
    cross join lateral (select (p_starts_at at time zone public.shop_tz())::date as d) x
   where b.barber_id = p_barber_id
     and b.weekday = extract(dow from x.d)::smallint
     and tstzrange((x.d + b.start_time) at time zone public.shop_tz(),
                   (x.d + b.end_time) at time zone public.shop_tz(), '[)')
         && tstzrange(p_starts_at, p_ends_at, '[)')
   order by b.start_time
   limit 1;
$$;

-- When a barber on a break (ad-hoc or recurring) is back; null when not on a break now.
create or replace function public.barber_back_at(p_barber_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(e) from (
    select o.ends_at as e
      from public.barber_time_off o
     where o.barber_id = p_barber_id and o.starts_at <= now() and o.ends_at > now()
    union all
    select (public.shop_today() + b.end_time) at time zone public.shop_tz()
      from public.barber_breaks b
     where b.barber_id = p_barber_id
       and b.weekday = extract(dow from public.shop_today())::smallint
       and (public.shop_today() + b.start_time) at time zone public.shop_tz() <= now()
       and (public.shop_today() + b.end_time) at time zone public.shop_tz() > now()
  ) x;
$$;

-- Start of the barber's next break (recurring or time off) today after p_from; null if none.
create or replace function public.next_break_start(p_barber_id uuid, p_from timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(s) from (
    select o.starts_at as s
      from public.barber_time_off o
     where o.barber_id = p_barber_id
       and o.starts_at > p_from
       and (o.starts_at at time zone public.shop_tz())::date = public.shop_today()
    union all
    select (public.shop_today() + b.start_time) at time zone public.shop_tz()
      from public.barber_breaks b
     where b.barber_id = p_barber_id
       and b.weekday = extract(dow from public.shop_today())::smallint
       and (public.shop_today() + b.start_time) at time zone public.shop_tz() > p_from
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- slot_conflict (replaces the EZ-001 version): + recurring breaks, + buffer
-- ---------------------------------------------------------------------------
create or replace function public.slot_conflict(
  p_barber_id      uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_ignore_appt_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz          text := public.shop_tz();
  v_local_start timestamp := p_starts_at at time zone v_tz;
  v_local_end   timestamp := p_ends_at at time zone v_tz;
  v_buffer      interval := make_interval(mins => coalesce((select buffer_after_service_min from public.shop_settings where id = 1), 0));
begin
  if not exists (select 1 from public.barbers where id = p_barber_id and is_active) then
    return 'barber_unavailable';
  end if;
  if public.closure_overlapping(p_starts_at, p_ends_at) is not null then
    return 'shop_closed';
  end if;
  if v_local_end::date <> v_local_start::date or not exists (
    select 1 from public.barber_shifts s
     where s.barber_id = p_barber_id
       and s.weekday = extract(dow from v_local_start)::smallint
       and s.start_time <= v_local_start::time
       and s.end_time   >= v_local_end::time
  ) then
    return 'outside_shift';
  end if;
  if public.break_overlapping(p_barber_id, p_starts_at, p_ends_at) is not null then
    return 'break';
  end if;
  if exists (
    select 1 from public.barber_time_off o
     where o.barber_id = p_barber_id
       and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return 'time_off';
  end if;
  -- Bookings keep `buffer_after_service_min` free after each other.
  if exists (
    select 1 from public.appointments a
     where a.barber_id = p_barber_id
       and a.id is distinct from p_ignore_appt_id
       and a.status in ('pending_payment', 'confirmed', 'checked_in', 'called', 'in_chair')
       and (a.status <> 'pending_payment' or a.hold_expires_at > now())
       and tstzrange(a.starts_at, a.ends_at + v_buffer, '[)') && tstzrange(p_starts_at, p_ends_at + v_buffer, '[)')
  ) then
    return 'slot_unavailable';
  end if;
  if exists (
    select 1 from public.reschedule_offers o
     where o.barber_id = p_barber_id
       and o.status = 'open' and o.expires_at > now()
       and o.appointment_id is distinct from p_ignore_appt_id
       and tstzrange(o.starts_at, o.ends_at + v_buffer, '[)') && tstzrange(p_starts_at, p_ends_at + v_buffer, '[)')
  ) then
    return 'slot_unavailable';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Break-aware Call Next (replaces the EZ-011 version)
-- ---------------------------------------------------------------------------
create or replace function public.desk_call_next(p_barber_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt        public.appointments;
  v_ticket      public.queue_tickets;
  v_free_at     timestamptz;
  v_next        public.appointments;
  v_break_at    timestamptz;
  v_limit_at    timestamptz;
  v_gap_min     integer;
  v_needed_min  integer;
  v_back_at     timestamptz;
begin
  perform public.assert_staff();

  if not exists (select 1 from public.barbers where id = p_barber_id and is_active) then
    raise exception using message = 'barber_unavailable', errcode = 'P0001';
  end if;

  -- EZ-003: nobody is called while the barber is on a break.
  v_back_at := public.barber_back_at(p_barber_id);
  if v_back_at is not null then
    raise exception using message = 'on_break', errcode = 'P0001', detail = v_back_at::text;
  end if;

  select * into v_appt
    from public.appointments
   where barber_id = p_barber_id
     and status in ('confirmed', 'checked_in')
     and starts_at <= now() + interval '10 minutes'
     and (starts_at at time zone public.shop_tz())::date = public.shop_today()
   order by starts_at
   limit 1
   for update skip locked;

  if v_appt.id is not null then
    update public.appointments set status = 'called', called_at = now() where id = v_appt.id;
    return jsonb_build_object('kind', 'appointment', 'id', v_appt.id, 'label', v_appt.display_name);
  end if;

  v_free_at := public.chair_free_at(p_barber_id);

  select * into v_next
    from public.appointments
   where barber_id = p_barber_id
     and status in ('confirmed', 'checked_in', 'pending_payment')
     and (status <> 'pending_payment' or hold_expires_at > now())
     and starts_at > now()
     and (starts_at at time zone public.shop_tz())::date = public.shop_today()
   order by starts_at
   limit 1;

  -- A walk-in must finish before the next booking AND before the next break.
  v_break_at := public.next_break_start(p_barber_id, v_free_at);
  v_limit_at := case
    when v_next.id is null then v_break_at
    when v_break_at is null then v_next.starts_at
    else least(v_next.starts_at, v_break_at)
  end;

  v_gap_min := case
    when v_limit_at is null then null
    else greatest(0, floor(extract(epoch from (v_limit_at - v_free_at)) / 60)::integer)
  end;

  select * into v_ticket
    from public.queue_tickets
   where shop_day = public.shop_today()
     and status = 'waiting'
     and (preferred_barber_id = p_barber_id or preferred_barber_id is null)
     and (v_gap_min is null or duration_min <= v_gap_min)
   order by ticket_number
   limit 1
   for update skip locked;

  if v_ticket.id is null then
    select min(duration_min) into v_needed_min
      from public.queue_tickets
     where shop_day = public.shop_today()
       and status = 'waiting'
       and (preferred_barber_id = p_barber_id or preferred_barber_id is null);
    if v_needed_min is null then
      return null; -- nobody waiting for this chair
    end if;
    return jsonb_build_object(
      'kind', null,
      'reason', 'no_fit',
      'gap_min', v_gap_min,
      'needed_min', v_needed_min,
      'next_appointment_id', case when v_limit_at = v_next.starts_at then v_next.id end,
      'next_label', case when v_limit_at = v_next.starts_at then v_next.display_name else 'a break' end,
      'next_starts_at', v_limit_at
    );
  end if;

  update public.queue_tickets
     set status = 'called', called_at = now(), barber_id = p_barber_id
   where id = v_ticket.id;
  return jsonb_build_object('kind', 'ticket', 'id', v_ticket.id, 'label', v_ticket.code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk: "Take a break" (5–60 min from now) / "Back now"
-- ---------------------------------------------------------------------------
create or replace function public.desk_take_break(p_barber_id uuid, p_minutes integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end timestamptz;
begin
  perform public.assert_staff();
  if p_minutes is null or p_minutes not between 5 and 60 then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;
  if not exists (select 1 from public.barbers where id = p_barber_id and is_active and is_on_duty) then
    raise exception using message = 'barber_unavailable', errcode = 'P0001';
  end if;
  perform public.lock_barber(p_barber_id);
  if public.chair_is_busy(p_barber_id, null) then
    raise exception using message = 'chair_busy', errcode = 'P0001';
  end if;
  if public.barber_back_at(p_barber_id) is not null then
    raise exception using message = 'already_on_break', errcode = 'P0001';
  end if;

  insert into public.barber_time_off (barber_id, starts_at, ends_at, reason, kind)
  values (p_barber_id, now(), now() + make_interval(mins => p_minutes), 'Break', 'break')
  returning ends_at into v_end;
  return v_end;
end;
$$;

create or replace function public.desk_end_break(p_barber_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff();
  update public.barber_time_off
     set ends_at = greatest(now(), starts_at + interval '1 microsecond')
   where barber_id = p_barber_id and kind = 'break'
     and starts_at <= now() and ends_at > now();
  if not found then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: recurring breaks
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_break(
  p_id         uuid,
  p_barber_id  uuid,
  p_weekday    integer,
  p_start_time time,
  p_end_time   time,
  p_label      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.barber_breaks;
  v_after  public.barber_breaks;
  v_label  text := coalesce(nullif(btrim(p_label), ''), 'Break');
begin
  perform public.assert_owner();
  if p_weekday is null or p_weekday not between 0 and 6 or p_start_time is null or p_end_time is null
     or p_end_time <= p_start_time or length(v_label) > 40
     or not exists (select 1 from public.barbers where id = p_barber_id) then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.barber_breaks (barber_id, weekday, start_time, end_time, label)
    values (p_barber_id, p_weekday, p_start_time, p_end_time, v_label)
    returning * into v_after;
    perform public.log_catalog_change('barber_breaks', v_after.id::text, 'create', null, to_jsonb(v_after));
  else
    select * into v_before from public.barber_breaks where id = p_id for update;
    if v_before.id is null then
      raise exception using message = 'not_found', errcode = 'P0001';
    end if;
    update public.barber_breaks
       set barber_id = p_barber_id, weekday = p_weekday, start_time = p_start_time, end_time = p_end_time, label = v_label
     where id = p_id
    returning * into v_after;
    perform public.log_catalog_change('barber_breaks', v_after.id::text, 'update', to_jsonb(v_before), to_jsonb(v_after));
  end if;
  return v_after.id;
end;
$$;

create or replace function public.admin_delete_break(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.barber_breaks;
begin
  perform public.assert_owner();
  delete from public.barber_breaks where id = p_id returning * into v_before;
  if v_before.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
  perform public.log_catalog_change('barber_breaks', v_before.id::text, 'delete', to_jsonb(v_before), null);
end;
$$;

-- Fees & rules (replaces the EZ-009 version): + buffer, + EZ-002 reschedule rules.
create or replace function public.admin_update_settings(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before  public.shop_settings;
  v_after   public.shop_settings;
  v_allowed text[] := array[
    'shop_name', 'shop_phone', 'shop_address',
    'deposit_percent', 'min_deposit_cents', 'hold_minutes',
    'booking_horizon_days', 'min_lead_min', 'slot_interval_min',
    'notify_lead_min', 'delay_notify_min', 'early_offer_min',
    'reschedule_cutoff_min', 'offer_hold_hours', 'buffer_after_service_min'
  ];
  v_key text;
begin
  perform public.assert_owner();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any(v_allowed) then
      raise exception using message = 'invalid_value', errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  select * into v_before from public.shop_settings where id = 1 for update;

  begin
    update public.shop_settings s set
      shop_name                = coalesce(nullif(btrim(p_patch->>'shop_name'), ''), s.shop_name),
      shop_phone               = case when p_patch ? 'shop_phone' then nullif(btrim(p_patch->>'shop_phone'), '') else s.shop_phone end,
      shop_address             = case when p_patch ? 'shop_address' then nullif(btrim(p_patch->>'shop_address'), '') else s.shop_address end,
      deposit_percent          = coalesce((p_patch->>'deposit_percent')::integer, s.deposit_percent),
      min_deposit_cents        = coalesce((p_patch->>'min_deposit_cents')::integer, s.min_deposit_cents),
      hold_minutes             = coalesce((p_patch->>'hold_minutes')::integer, s.hold_minutes),
      booking_horizon_days     = coalesce((p_patch->>'booking_horizon_days')::integer, s.booking_horizon_days),
      min_lead_min             = coalesce((p_patch->>'min_lead_min')::integer, s.min_lead_min),
      slot_interval_min        = coalesce((p_patch->>'slot_interval_min')::integer, s.slot_interval_min),
      notify_lead_min          = coalesce((p_patch->>'notify_lead_min')::integer, s.notify_lead_min),
      delay_notify_min         = coalesce((p_patch->>'delay_notify_min')::integer, s.delay_notify_min),
      early_offer_min          = coalesce((p_patch->>'early_offer_min')::integer, s.early_offer_min),
      reschedule_cutoff_min    = coalesce((p_patch->>'reschedule_cutoff_min')::integer, s.reschedule_cutoff_min),
      offer_hold_hours         = coalesce((p_patch->>'offer_hold_hours')::integer, s.offer_hold_hours),
      buffer_after_service_min = coalesce((p_patch->>'buffer_after_service_min')::integer, s.buffer_after_service_min)
     where id = 1
    returning * into v_after;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception using message = 'invalid_value', errcode = 'P0001';
  end;

  if v_after.slot_interval_min not in (5, 10, 15, 20, 30, 60) then
    raise exception using message = 'invalid_value', errcode = 'P0001', detail = 'slot_interval_min';
  end if;

  perform public.log_catalog_change('shop_settings', '1', 'update', to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges + realtime (breaks and time off move live ETAs)
-- ---------------------------------------------------------------------------
revoke execute on function public.break_overlapping(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.barber_back_at(uuid) from public, anon;
revoke execute on function public.next_break_start(uuid, timestamptz) from public, anon;
revoke execute on function public.desk_take_break(uuid, integer) from public, anon;
revoke execute on function public.desk_end_break(uuid) from public, anon;
revoke execute on function public.admin_save_break(uuid, uuid, integer, time, time, text) from public, anon;
revoke execute on function public.admin_delete_break(uuid) from public, anon;
revoke execute on function public.admin_update_settings(jsonb) from public, anon;
revoke execute on function public.slot_conflict(uuid, timestamptz, timestamptz, uuid) from public, anon;

grant execute on function public.break_overlapping(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.barber_back_at(uuid) to authenticated, service_role;
grant execute on function public.next_break_start(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.desk_take_break(uuid, integer) to authenticated;
grant execute on function public.desk_end_break(uuid) to authenticated;
grant execute on function public.admin_save_break(uuid, uuid, integer, time, time, text) to authenticated;
grant execute on function public.admin_delete_break(uuid) to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
grant execute on function public.slot_conflict(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.desk_call_next(uuid) to authenticated;

alter publication supabase_realtime add table public.barber_breaks;
alter publication supabase_realtime add table public.barber_time_off;
