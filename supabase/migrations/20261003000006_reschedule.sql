-- =============================================================================
-- EasyCutz — EZ-002 reschedule flow + dynamic reschedule proposals
--
-- * reschedule_appointment core: moves a booking in place (same pass token,
--   same payment/deposit). The gist exclusion constraint on appointments still
--   guarantees no double booking.
-- * reschedule_offers: system-proposed new times, held as SOFT HOLDS. Open
--   offers block their window for other customers until they expire (default
--   24 h) or the customer picks one.
-- * booking_events: audit of reschedules, requests and offers.
-- * Customers may self-reschedule up to `reschedule_cutoff_min` before their
--   booking, or any time after the shop requested a reschedule.
-- =============================================================================

alter table public.shop_settings
  add column if not exists reschedule_cutoff_min integer not null default 120 check (reschedule_cutoff_min between 0 and 10080),
  add column if not exists offer_hold_hours      integer not null default 24  check (offer_hold_hours between 1 and 168);

alter table public.appointments
  add column if not exists reschedule_requested_at timestamptz;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table public.booking_events (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  ticket_id      uuid references public.queue_tickets(id) on delete cascade,
  kind           text not null check (kind in ('rescheduled', 'reschedule_requested', 'offers_created', 'offers_released')),
  actor          text not null check (actor in ('customer', 'staff', 'system')),
  actor_user     uuid,
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  check (appointment_id is not null or ticket_id is not null)
);
create index booking_events_appointment_idx on public.booking_events (appointment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Offers (soft holds)
-- ---------------------------------------------------------------------------
create table public.reschedule_offers (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  barber_id      uuid not null references public.barbers(id),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  reason         text not null check (reason in ('delay', 'closure', 'barber_unavailable', 'early', 'manual')),
  status         text not null default 'open' check (status in ('open', 'accepted', 'released', 'expired')),
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Open offers for DIFFERENT bookings can never overlap on the same chair.
  constraint reschedule_offers_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&,
    appointment_id with <>
  ) where (status = 'open')
);
create index reschedule_offers_appointment_idx on public.reschedule_offers (appointment_id) where status = 'open';
create index reschedule_offers_barber_idx on public.reschedule_offers (barber_id, starts_at) where status = 'open';

alter table public.booking_events    enable row level security;
alter table public.reschedule_offers enable row level security;
create policy "staff read booking events" on public.booking_events for select to authenticated using (public.is_staff());
create policy "staff read offers" on public.reschedule_offers for select to authenticated using (public.is_staff());
revoke insert, update, delete, truncate on public.booking_events, public.reschedule_offers from anon, authenticated;
grant select on public.booking_events, public.reschedule_offers to authenticated;
revoke select on public.booking_events, public.reschedule_offers from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.lock_barber(p_barber_id uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtext('easycutz:barber:' || p_barber_id::text));
$$;

-- Why a window can't be used on this chair (null = free). Ignores the given booking and its own offers.
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
begin
  if not exists (select 1 from public.barbers where id = p_barber_id and is_active) then
    return 'barber_unavailable';
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
  if exists (
    select 1 from public.barber_time_off o
     where o.barber_id = p_barber_id
       and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return 'time_off';
  end if;
  if exists (
    select 1 from public.appointments a
     where a.barber_id = p_barber_id
       and a.id is distinct from p_ignore_appt_id
       and a.status in ('pending_payment', 'confirmed', 'checked_in', 'called', 'in_chair')
       and (a.status <> 'pending_payment' or a.hold_expires_at > now())
       and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return 'slot_unavailable';
  end if;
  if exists (
    select 1 from public.reschedule_offers o
     where o.barber_id = p_barber_id
       and o.status = 'open' and o.expires_at > now()
       and o.appointment_id is distinct from p_ignore_appt_id
       and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return 'slot_unavailable';
  end if;
  return null;
end;
$$;

-- Holds + offers sweeper (replaces the version in _functions.sql)
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.appointments
     set status = 'expired',
         payment_status = case when payment_status = 'pending' then 'failed' else payment_status end::public.payment_status
   where status = 'pending_payment'
     and hold_expires_at is not null
     and hold_expires_at < now();
  get diagnostics v_count = row_count;

  update public.reschedule_offers set status = 'expired'
   where status = 'open' and expires_at <= now();

  return v_count;
end;
$$;

-- Release open offers when a booking stops being live.
create or replace function public.release_offers_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('cancelled', 'no_show', 'completed', 'expired', 'in_chair')
     and old.status is distinct from new.status then
    update public.reschedule_offers set status = 'released'
     where appointment_id = new.id and status = 'open';
  end if;
  return new;
end;
$$;

create trigger appointments_release_offers after update of status on public.appointments
  for each row execute function public.release_offers_on_close();

-- ---------------------------------------------------------------------------
-- New bookings respect open offers (replaces book_appointment from _functions.sql)
-- ---------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_barber_id      uuid,
  p_starts_at      timestamptz,
  p_service_ids    uuid[],
  p_addon_ids      uuid[],
  p_customer_name  text,
  p_phone          text,
  p_email          text,
  p_payment_option public.payment_option,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings    public.shop_settings;
  v_tz          text;
  v_cart        record;
  v_due         integer;
  v_ends_at     timestamptz;
  v_local_start timestamp;
  v_local_end   timestamp;
  v_minute      integer;
  v_candidate   uuid;
  v_appt        public.appointments;
  v_private     public.booking_private;
  v_status      public.appointment_status;
begin
  perform public.expire_stale_holds();

  select * into v_settings from public.shop_settings where id = 1;
  v_tz := v_settings.timezone;

  select * into v_cart from public.price_cart(p_service_ids, p_addon_ids);
  v_due := public.amount_due_now(v_cart.o_price_cents, p_payment_option);

  v_ends_at     := p_starts_at + make_interval(mins => v_cart.o_duration_min);
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end   := v_ends_at at time zone v_tz;
  v_minute      := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;

  if p_starts_at < now() + make_interval(mins => v_settings.min_lead_min) then
    raise exception using message = 'slot_in_past', errcode = 'P0001';
  end if;
  if v_local_start::date > public.shop_today() + v_settings.booking_horizon_days then
    raise exception using message = 'beyond_horizon', errcode = 'P0001';
  end if;
  if extract(second from v_local_start) <> 0 or v_minute % v_settings.slot_interval_min <> 0 then
    raise exception using message = 'misaligned_slot', errcode = 'P0001';
  end if;
  if v_local_end::date <> v_local_start::date then
    raise exception using message = 'slot_unavailable', errcode = 'P0001';
  end if;
  if p_barber_id is not null and not exists (select 1 from public.barbers where id = p_barber_id and is_active) then
    raise exception using message = 'barber_unavailable', errcode = 'P0001';
  end if;

  v_status := case when v_due > 0 then 'pending_payment' else 'confirmed' end;

  for v_candidate in
    select b.id
      from public.barbers b
     where b.is_active
       and (p_barber_id is null or b.id = p_barber_id)
     order by (
       select count(*) from public.appointments a
        where a.barber_id = b.id
          and (a.starts_at at time zone v_tz)::date = v_local_start::date
          and a.status in ('pending_payment', 'confirmed', 'checked_in', 'called', 'in_chair', 'completed')
     ), b.sort_order, b.id
  loop
    perform public.lock_barber(v_candidate);
    -- shift, time off, live bookings and other customers' open offers
    if public.slot_conflict(v_candidate, p_starts_at, v_ends_at, null) is not null then
      continue;
    end if;
    begin
      insert into public.appointments (
        barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, addon_ids,
        service_summary, display_name, status, payment_option, payment_status,
        amount_due_now_cents, hold_expires_at
      ) values (
        v_candidate, p_starts_at, v_ends_at, v_cart.o_duration_min, v_cart.o_price_cents,
        p_service_ids, coalesce(p_addon_ids, '{}'), v_cart.o_summary, public.make_display_name(p_customer_name),
        v_status, p_payment_option,
        case when v_due > 0 then 'pending' else 'unpaid' end::public.payment_status,
        v_due,
        case when v_due > 0 then now() + make_interval(mins => v_settings.hold_minutes) else null end
      )
      returning * into v_appt;
      exit;
    exception when exclusion_violation then
      v_appt := null;
    end;
  end loop;

  if v_appt.id is null then
    raise exception using message = 'slot_unavailable', errcode = 'P0001';
  end if;

  insert into public.booking_private (kind, appointment_id, customer_name, phone, email, notes)
  values ('appointment', v_appt.id, btrim(p_customer_name), p_phone,
          nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_private;

  return jsonb_build_object(
    'kind', 'appointment',
    'id', v_appt.id,
    'barber_id', v_appt.barber_id,
    'starts_at', v_appt.starts_at,
    'ends_at', v_appt.ends_at,
    'access_token', v_private.access_token,
    'price_cents', v_appt.price_cents,
    'duration_min', v_appt.duration_min,
    'amount_due_now_cents', v_due,
    'status', v_appt.status,
    'service_summary', v_appt.service_summary
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Core move (internal; called by the customer and desk wrappers below)
--   p_enforce_customer_rules: cutoff, lead time, horizon, slot alignment
-- ---------------------------------------------------------------------------
create or replace function public.do_reschedule(
  p_appointment_id         uuid,
  p_starts_at              timestamptz,
  p_barber_id              uuid,
  p_actor                  text,
  p_offer_id               uuid,
  p_enforce_customer_rules boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings  public.shop_settings;
  v_appt      public.appointments;
  v_barber    uuid;
  v_ends_at   timestamptz;
  v_local     timestamp;
  v_minute    integer;
  v_conflict  text;
  v_same_day  boolean;
begin
  perform public.expire_stale_holds();
  select * into v_settings from public.shop_settings where id = 1;

  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
  if v_appt.status not in ('confirmed', 'checked_in') then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  v_barber  := coalesce(p_barber_id, v_appt.barber_id);
  v_ends_at := p_starts_at + make_interval(mins => v_appt.duration_min);

  if p_enforce_customer_rules then
    if v_appt.reschedule_requested_at is null
       and v_appt.starts_at < now() + make_interval(mins => v_settings.reschedule_cutoff_min) then
      raise exception using message = 'reschedule_cutoff', errcode = 'P0001';
    end if;
    v_local  := p_starts_at at time zone v_settings.timezone;
    v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
    if p_starts_at < now() + make_interval(mins => v_settings.min_lead_min) then
      raise exception using message = 'slot_in_past', errcode = 'P0001';
    end if;
    if v_local::date > public.shop_today() + v_settings.booking_horizon_days then
      raise exception using message = 'beyond_horizon', errcode = 'P0001';
    end if;
    if extract(second from v_local) <> 0 or v_minute % v_settings.slot_interval_min <> 0 then
      raise exception using message = 'misaligned_slot', errcode = 'P0001';
    end if;
  elsif p_starts_at < now() - interval '1 minute' then
    raise exception using message = 'slot_in_past', errcode = 'P0001';
  end if;

  perform public.lock_barber(v_barber);
  v_conflict := public.slot_conflict(v_barber, p_starts_at, v_ends_at, v_appt.id);
  if v_conflict is not null then
    raise exception using message = case when v_conflict = 'barber_unavailable' then 'barber_unavailable' else 'slot_unavailable' end,
                          errcode = 'P0001';
  end if;

  v_same_day := (v_appt.starts_at at time zone v_settings.timezone)::date = (p_starts_at at time zone v_settings.timezone)::date;
  begin
    update public.appointments
       set barber_id = v_barber,
           starts_at = p_starts_at,
           ends_at = v_ends_at,
           status = case when v_same_day then status else 'confirmed' end::public.appointment_status,
           checked_in_at = case when v_same_day then checked_in_at else null end,
           expected_end_at = null,
           delay_notified_at = null,
           delay_notified_min = null,
           reschedule_requested_at = null
     where id = v_appt.id;
  exception when exclusion_violation then
    raise exception using message = 'slot_unavailable', errcode = 'P0001';
  end;

  update public.reschedule_offers
     set status = case when id = p_offer_id then 'accepted' else 'released' end
   where appointment_id = v_appt.id and status = 'open';

  insert into public.booking_events (appointment_id, kind, actor, actor_user, data)
  values (v_appt.id, 'rescheduled', p_actor, auth.uid(), jsonb_build_object(
    'from_starts_at', v_appt.starts_at, 'to_starts_at', p_starts_at,
    'from_barber_id', v_appt.barber_id, 'to_barber_id', v_barber,
    'offer_id', p_offer_id));

  return jsonb_build_object('id', v_appt.id, 'starts_at', p_starts_at, 'ends_at', v_ends_at, 'barber_id', v_barber);
end;
$$;

-- Customer (via API route, service role): pick an offer, or a free time if allowed.
create or replace function public.reschedule_by_token(
  p_token     uuid,
  p_starts_at timestamptz,
  p_barber_id uuid,
  p_offer_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private public.booking_private;
  v_offer   public.reschedule_offers;
begin
  select * into v_private from public.booking_private where access_token = p_token and kind = 'appointment';
  if v_private.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;

  if p_offer_id is not null then
    perform public.expire_stale_holds();
    select * into v_offer from public.reschedule_offers
     where id = p_offer_id and appointment_id = v_private.appointment_id and status = 'open' and expires_at > now();
    if v_offer.id is null then
      raise exception using message = 'offer_expired', errcode = 'P0001';
    end if;
    return public.do_reschedule(v_private.appointment_id, v_offer.starts_at, v_offer.barber_id, 'customer', v_offer.id, false);
  end if;

  if p_starts_at is null then
    raise exception using message = 'invalid_request', errcode = 'P0001';
  end if;
  return public.do_reschedule(v_private.appointment_id, p_starts_at, p_barber_id, 'customer', null, true);
end;
$$;

-- Desk: move a booking directly (customer agreed on the phone / at the counter).
create or replace function public.desk_reschedule(
  p_appointment_id uuid,
  p_starts_at      timestamptz,
  p_barber_id      uuid,
  p_offer_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.reschedule_offers;
begin
  perform public.assert_staff();
  if p_offer_id is not null then
    select * into v_offer from public.reschedule_offers
     where id = p_offer_id and appointment_id = p_appointment_id and status = 'open';
    if v_offer.id is null then
      raise exception using message = 'offer_expired', errcode = 'P0001';
    end if;
    return public.do_reschedule(p_appointment_id, v_offer.starts_at, v_offer.barber_id, 'staff', v_offer.id, false);
  end if;
  return public.do_reschedule(p_appointment_id, p_starts_at, p_barber_id, 'staff', null, false);
end;
$$;

-- Desk: publish proposals (computed by the server's slot engine) as soft holds.
--   p_offers: [{ "starts_at": "...", "barber_id": "..." }, ...]
create or replace function public.create_reschedule_offers(
  p_appointment_id uuid,
  p_reason         text,
  p_offers         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.shop_settings;
  v_appt     public.appointments;
  v_item     jsonb;
  v_start    timestamptz;
  v_barber   uuid;
  v_offer    public.reschedule_offers;
  v_created  jsonb := '[]'::jsonb;
begin
  perform public.assert_staff();
  if p_reason not in ('delay', 'closure', 'barber_unavailable', 'early', 'manual') then
    raise exception using message = 'invalid_action', errcode = 'P0001';
  end if;
  if p_offers is null or jsonb_typeof(p_offers) <> 'array' or jsonb_array_length(p_offers) > 5 then
    raise exception using message = 'invalid_request', errcode = 'P0001';
  end if;

  select * into v_settings from public.shop_settings where id = 1;
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
  if v_appt.status not in ('confirmed', 'checked_in') then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  update public.reschedule_offers set status = 'released'
   where appointment_id = v_appt.id and status = 'open';

  for v_item in select * from jsonb_array_elements(p_offers) loop
    v_start  := (v_item->>'starts_at')::timestamptz;
    v_barber := (v_item->>'barber_id')::uuid;
    if v_start is null or v_barber is null or v_start < now() then
      continue;
    end if;
    perform public.lock_barber(v_barber);
    if public.slot_conflict(v_barber, v_start, v_start + make_interval(mins => v_appt.duration_min), v_appt.id) is not null then
      continue; -- taken since the proposal was computed
    end if;
    begin
      insert into public.reschedule_offers (appointment_id, barber_id, starts_at, ends_at, reason, expires_at)
      values (v_appt.id, v_barber, v_start, v_start + make_interval(mins => v_appt.duration_min), p_reason,
              least(now() + make_interval(hours => v_settings.offer_hold_hours), v_start))
      returning * into v_offer;
      v_created := v_created || jsonb_build_object(
        'id', v_offer.id, 'starts_at', v_offer.starts_at, 'ends_at', v_offer.ends_at,
        'barber_id', v_offer.barber_id, 'expires_at', v_offer.expires_at);
    exception when exclusion_violation then
      null;
    end;
  end loop;

  if p_reason <> 'early' then
    update public.appointments set reschedule_requested_at = now() where id = v_appt.id;
  end if;

  insert into public.booking_events (appointment_id, kind, actor, actor_user, data)
  values (v_appt.id, 'offers_created', 'staff', auth.uid(),
          jsonb_build_object('reason', p_reason, 'offers', v_created));

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.lock_barber(uuid) from public, anon, authenticated;
revoke execute on function public.slot_conflict(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.release_offers_on_close() from public, anon, authenticated;
revoke execute on function public.do_reschedule(uuid, timestamptz, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.reschedule_by_token(uuid, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.desk_reschedule(uuid, timestamptz, uuid, uuid) from public, anon;
revoke execute on function public.create_reschedule_offers(uuid, text, jsonb) from public, anon;
revoke execute on function public.book_appointment(uuid, timestamptz, uuid[], uuid[], text, text, text, public.payment_option, text) from public, anon, authenticated;
revoke execute on function public.expire_stale_holds() from public, anon, authenticated;

grant execute on function public.slot_conflict(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.reschedule_by_token(uuid, timestamptz, uuid, uuid) to service_role;
grant execute on function public.book_appointment(uuid, timestamptz, uuid[], uuid[], text, text, text, public.payment_option, text) to service_role;
grant execute on function public.expire_stale_holds() to service_role;
grant execute on function public.desk_reschedule(uuid, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.create_reschedule_offers(uuid, text, jsonb) to authenticated;
