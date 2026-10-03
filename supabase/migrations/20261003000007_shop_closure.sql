-- =============================================================================
-- EasyCutz — EZ-001 emergency shop closure
--
-- * shop_closures: history of "Close shop now" windows. A window is active
--   while now() is inside [starts_at, ends_at). Reopening shortens ends_at.
-- * shop_settings.closed_until / closure_message / closure_reason: the live,
--   public state customers see (shop_settings is already in Realtime).
-- * While a window is active: no new walk-in tickets, no bookings or
--   reschedules into the window (slot_conflict returns 'shop_closed').
-- * Closing the shop (decided 2026-10-03):
--     - today's waiting/called walk-in tickets are CANCELLED
--       (cancel_reason = 'shop_closed'); paid ones are flagged needs_refund;
--     - appointments overlapping the window are NOT cancelled; they are marked
--       reschedule_requested_at so the customer can move them any time, and
--       the server publishes reschedule proposals (EZ-002) for each one;
--     - unpaid payment holds in the window are released (expired);
--     - other customers' open reschedule offers inside the window are released.
-- * closure_impacts records every affected booking and whether the desk has
--   sent its tap-to-send message (staff only; contains no contact details).
-- =============================================================================

alter table public.shop_settings
  add column if not exists closed_until    timestamptz,
  add column if not exists closure_message text check (closure_message is null or length(closure_message) between 1 and 280),
  add column if not exists closure_reason  text;

alter table public.queue_tickets
  add column if not exists cancel_reason text check (cancel_reason is null or cancel_reason in ('customer', 'shop_closed', 'staff'));

create table public.shop_closures (
  id              uuid primary key default gen_random_uuid(),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz not null,
  planned_ends_at timestamptz not null,
  reason          text not null check (reason in ('power', 'weather', 'illness', 'emergency', 'other')),
  public_message  text not null check (length(public_message) between 1 and 280),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  reopened_at     timestamptz,
  reopened_by     uuid,
  check (ends_at > starts_at)
);
create index shop_closures_window_idx on public.shop_closures using gist (tstzrange(starts_at, ends_at, '[)'));

create table public.closure_impacts (
  id             uuid primary key default gen_random_uuid(),
  closure_id     uuid not null references public.shop_closures(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  ticket_id      uuid references public.queue_tickets(id) on delete cascade,
  action         text not null check (action in ('ticket_cancelled', 'appointment_affected', 'hold_released')),
  had_payment    boolean not null default false,
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  check ((appointment_id is null) <> (ticket_id is null)),
  unique (closure_id, appointment_id),
  unique (closure_id, ticket_id)
);
create index closure_impacts_appointment_idx on public.closure_impacts (appointment_id);
create index closure_impacts_ticket_idx on public.closure_impacts (ticket_id);

alter table public.shop_closures   enable row level security;
alter table public.closure_impacts enable row level security;
create policy "staff read closures" on public.shop_closures for select to authenticated using (public.is_staff());
create policy "staff read closure impacts" on public.closure_impacts for select to authenticated using (public.is_staff());
revoke all on public.shop_closures, public.closure_impacts from anon;
revoke insert, update, delete, truncate on public.shop_closures, public.closure_impacts from authenticated;
grant select on public.shop_closures, public.closure_impacts to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The closure window overlapping [p_starts_at, p_ends_at), if any.
create or replace function public.closure_overlapping(p_starts_at timestamptz, p_ends_at timestamptz)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.shop_closures c
   where tstzrange(c.starts_at, c.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
   order by c.starts_at
   limit 1;
$$;

create or replace function public.shop_closed_now()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_closures c
     where tstzrange(c.starts_at, c.ends_at, '[)') @> now()
  );
$$;

-- slot_conflict (replaces the EZ-002 version): closure windows block every chair.
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

-- ---------------------------------------------------------------------------
-- Walk-in tickets refuse while the shop is closed (replaces _functions.sql)
-- ---------------------------------------------------------------------------
create or replace function public.issue_queue_ticket(
  p_preferred_barber_id uuid,
  p_service_ids         uuid[],
  p_addon_ids           uuid[],
  p_customer_name       text,
  p_phone               text,
  p_email               text,
  p_payment_option      public.payment_option,
  p_notes               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day     date := public.shop_today();
  v_cart    record;
  v_prefix  text;
  v_number  integer;
  v_ticket  public.queue_tickets;
  v_private public.booking_private;
  v_due     integer;
begin
  -- EZ-001: emergency closure pauses the live queue.
  if public.shop_closed_now() then
    raise exception using message = 'shop_closed', errcode = 'P0001';
  end if;

  if p_preferred_barber_id is null then
    if not exists (select 1 from public.barbers where is_active and is_on_duty) then
      raise exception using message = 'shop_closed', errcode = 'P0001';
    end if;
    v_prefix := 'W';
  else
    select ticket_prefix into v_prefix
      from public.barbers
     where id = p_preferred_barber_id and is_active and is_on_duty;
    if v_prefix is null then
      raise exception using message = 'barber_unavailable', errcode = 'P0001';
    end if;
  end if;

  select * into v_cart from public.price_cart(p_service_ids, p_addon_ids);
  v_due := public.amount_due_now(v_cart.o_price_cents, p_payment_option);

  -- Serialise ticket numbering for the day (and against a concurrent closure).
  perform pg_advisory_xact_lock(hashtext('easycutz:queue:' || v_day::text));
  if public.shop_closed_now() then
    raise exception using message = 'shop_closed', errcode = 'P0001';
  end if;

  -- One live ticket per phone number per day.
  if exists (
    select 1
      from public.booking_private bp
      join public.queue_tickets t on t.id = bp.ticket_id
     where bp.phone = p_phone
       and t.shop_day = v_day
       and t.status in ('waiting', 'called', 'in_chair')
  ) then
    raise exception using message = 'already_in_queue', errcode = 'P0001';
  end if;

  select coalesce(max(ticket_number), 0) + 1 into v_number
    from public.queue_tickets where shop_day = v_day;

  insert into public.queue_tickets (
    shop_day, ticket_number, code, preferred_barber_id, duration_min, price_cents,
    service_ids, addon_ids, service_summary, display_name,
    payment_option, payment_status, amount_due_now_cents
  ) values (
    v_day, v_number, v_prefix || '-' || v_number, p_preferred_barber_id, v_cart.o_duration_min, v_cart.o_price_cents,
    p_service_ids, coalesce(p_addon_ids, '{}'), v_cart.o_summary, public.make_display_name(p_customer_name),
    p_payment_option, case when v_due > 0 then 'pending' else 'unpaid' end::public.payment_status, v_due
  )
  returning * into v_ticket;

  insert into public.booking_private (kind, ticket_id, customer_name, phone, email, notes)
  values ('ticket', v_ticket.id, btrim(p_customer_name), p_phone,
          nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_private;

  return jsonb_build_object(
    'kind', 'ticket',
    'id', v_ticket.id,
    'code', v_ticket.code,
    'access_token', v_private.access_token,
    'price_cents', v_ticket.price_cents,
    'duration_min', v_ticket.duration_min,
    'amount_due_now_cents', v_due,
    'service_summary', v_ticket.service_summary
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking into a closure window -> 'closed_window' (replaces the EZ-002 version)
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
  -- EZ-001
  if public.closure_overlapping(p_starts_at, v_ends_at) is not null then
    raise exception using message = 'closed_window', errcode = 'P0001';
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
    -- A closure may have started while we were looping.
    if public.closure_overlapping(p_starts_at, v_ends_at) is not null then
      raise exception using message = 'closed_window', errcode = 'P0001';
    end if;
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
-- Customer cancel (replaces _functions.sql): records the reason, and a paid
-- booking cancelled because of a closure is flagged for refund.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private public.booking_private;
  v_rows    integer;
begin
  select * into v_private from public.booking_private where access_token = p_token;
  if v_private.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;

  if v_private.kind = 'ticket' then
    update public.queue_tickets set status = 'cancelled', cancel_reason = 'customer'
     where id = v_private.ticket_id and status in ('waiting', 'called');
  else
    update public.appointments set status = 'cancelled', hold_expires_at = null
     where id = v_private.appointment_id and status in ('pending_payment', 'confirmed', 'checked_in', 'called');
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  if v_private.kind = 'appointment' and exists (
    select 1 from public.closure_impacts i
     where i.appointment_id = v_private.appointment_id and i.action = 'appointment_affected'
  ) then
    update public.payments set needs_refund = true
     where appointment_id = v_private.appointment_id and status = 'paid';
  end if;

  return jsonb_build_object('kind', v_private.kind, 'cancelled', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stripe settlement (replaces _functions.sql): a payment that lands after the
-- booking was cancelled/released by a closure is flagged for refund instead of
-- reviving the booking.
-- ---------------------------------------------------------------------------
create or replace function public.apply_checkout_result(
  p_session_id        text,
  p_paid              boolean,
  p_payment_intent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_appt    public.appointments;
  v_ticket  public.queue_tickets;
  v_outcome text := 'ok';
begin
  select * into v_payment from public.payments where stripe_checkout_session_id = p_session_id for update;
  if v_payment.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
  if v_payment.status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid');
  end if;

  update public.payments
     set status = case when p_paid then 'paid' else 'failed' end::public.payment_status,
         stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
   where id = v_payment.id;

  if v_payment.kind = 'ticket' then
    select * into v_ticket from public.queue_tickets where id = v_payment.ticket_id;
    update public.queue_tickets
       set payment_status = case when p_paid then 'paid' else 'failed' end::public.payment_status
     where id = v_payment.ticket_id;
    if p_paid and v_ticket.status in ('cancelled', 'no_show') then
      update public.payments set needs_refund = true where id = v_payment.id;
      v_outcome := 'needs_refund';
    end if;
    return jsonb_build_object('outcome', v_outcome);
  end if;

  if p_paid then
    select * into v_appt from public.appointments where id = v_payment.appointment_id;
    if v_appt.status = 'expired' and public.closure_overlapping(v_appt.starts_at, v_appt.ends_at) is not null then
      update public.appointments set payment_status = 'paid' where id = v_appt.id;
      update public.payments set needs_refund = true where id = v_payment.id;
      return jsonb_build_object('outcome', 'needs_refund');
    end if;
    begin
      update public.appointments
         set payment_status = 'paid',
             status = case when status in ('pending_payment', 'expired') then 'confirmed' else status end::public.appointment_status,
             hold_expires_at = null
       where id = v_payment.appointment_id;
    exception when exclusion_violation then
      update public.appointments set payment_status = 'paid' where id = v_payment.appointment_id;
      update public.payments set needs_refund = true where id = v_payment.id;
      v_outcome := 'needs_refund';
    end;
  else
    update public.appointments
       set payment_status = 'failed',
           status = case when status = 'pending_payment' then 'expired' else status end::public.appointment_status,
           hold_expires_at = null
     where id = v_payment.appointment_id;
  end if;

  return jsonb_build_object('outcome', v_outcome);
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk: close the shop now (or change the reopen time / message of the
-- active closure). Re-running it only adds bookings not yet recorded.
-- ---------------------------------------------------------------------------
create or replace function public.desk_close_shop(
  p_until   timestamptz,
  p_reason  text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings  public.shop_settings;
  v_closure   public.shop_closures;
  v_message   text := btrim(coalesce(p_message, ''));
  v_tickets   integer;
  v_appts     uuid[];
  v_holds     integer;
  v_released  integer;
begin
  perform public.assert_staff();
  select * into v_settings from public.shop_settings where id = 1;

  if p_reason is null or p_reason not in ('power', 'weather', 'illness', 'emergency', 'other') then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;
  if length(v_message) not between 1 and 280 then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;
  if p_until is null
     or p_until < now() + interval '5 minutes'
     or p_until > now() + make_interval(days => v_settings.booking_horizon_days + 1) then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;

  -- One closure change at a time; also serialises against new walk-in tickets.
  perform pg_advisory_xact_lock(hashtext('easycutz:closure'));
  perform pg_advisory_xact_lock(hashtext('easycutz:queue:' || public.shop_today()::text));

  select * into v_closure from public.shop_closures
   where tstzrange(starts_at, ends_at, '[)') @> now()
   order by starts_at desc limit 1
   for update;

  if v_closure.id is null then
    insert into public.shop_closures (starts_at, ends_at, planned_ends_at, reason, public_message, created_by)
    values (now(), p_until, p_until, p_reason, v_message, auth.uid())
    returning * into v_closure;
  else
    update public.shop_closures
       set ends_at = p_until, planned_ends_at = p_until, reason = p_reason, public_message = v_message
     where id = v_closure.id
    returning * into v_closure;
  end if;

  update public.shop_settings
     set closed_until = v_closure.ends_at, closure_message = v_message, closure_reason = p_reason
   where id = 1;

  -- 1) Today's waiting / called walk-ins are cancelled.
  with cancelled as (
    update public.queue_tickets
       set status = 'cancelled', cancel_reason = 'shop_closed'
     where shop_day = public.shop_today()
       and status in ('waiting', 'called')
    returning id, payment_status
  ), logged as (
    insert into public.closure_impacts (closure_id, ticket_id, action, had_payment)
    select v_closure.id, c.id, 'ticket_cancelled', c.payment_status = 'paid' from cancelled c
    on conflict do nothing
    returning ticket_id
  )
  select count(*) into v_tickets from logged;

  update public.payments p set needs_refund = true
    from public.closure_impacts i
   where i.closure_id = v_closure.id and i.ticket_id = p.ticket_id and p.status = 'paid';

  -- 2) Unpaid payment holds inside the window are released.
  with released as (
    update public.appointments
       set status = 'expired', hold_expires_at = null
     where status = 'pending_payment'
       and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_closure.starts_at, v_closure.ends_at, '[)')
    returning id
  ), logged as (
    insert into public.closure_impacts (closure_id, appointment_id, action)
    select v_closure.id, r.id, 'hold_released' from released r
    on conflict do nothing
    returning appointment_id
  )
  select count(*) into v_holds from logged;

  -- 3) Live appointments in the window: customer may reschedule any time.
  --    Called-but-not-seated customers go back to checked in.
  update public.appointments
     set status = case when status = 'called' then 'checked_in' else status end::public.appointment_status,
         called_at = case when status = 'called' then null else called_at end,
         reschedule_requested_at = coalesce(reschedule_requested_at, now())
   where status in ('confirmed', 'checked_in', 'called')
     and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_closure.starts_at, v_closure.ends_at, '[)');

  insert into public.closure_impacts (closure_id, appointment_id, action, had_payment)
  select v_closure.id, a.id, 'appointment_affected', a.payment_status = 'paid'
    from public.appointments a
   where a.status in ('confirmed', 'checked_in')
     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_closure.starts_at, v_closure.ends_at, '[)')
  on conflict do nothing;

  select coalesce(array_agg(a.id order by a.starts_at), '{}') into v_appts
    from public.closure_impacts i
    join public.appointments a on a.id = i.appointment_id
   where i.closure_id = v_closure.id
     and i.action = 'appointment_affected'
     and a.status in ('confirmed', 'checked_in')
     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_closure.starts_at, v_closure.ends_at, '[)');

  -- 4) Offers held for other customers inside the window can't be honoured.
  update public.reschedule_offers
     set status = 'released'
   where status = 'open'
     and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_closure.starts_at, v_closure.ends_at, '[)');
  get diagnostics v_released = row_count;

  return jsonb_build_object(
    'closure_id', v_closure.id,
    'ends_at', v_closure.ends_at,
    'tickets_cancelled', v_tickets,
    'holds_released', v_holds,
    'offers_released', v_released,
    'appointment_ids', to_jsonb(v_appts)
  );
end;
$$;

-- Desk: reopen now. The closure stays as history with its shortened window.
create or replace function public.desk_reopen_shop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.shop_closures;
begin
  perform public.assert_staff();
  perform pg_advisory_xact_lock(hashtext('easycutz:closure'));

  select * into v_closure from public.shop_closures
   where tstzrange(starts_at, ends_at, '[)') @> now()
   order by starts_at desc limit 1
   for update;
  if v_closure.id is null then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  update public.shop_closures
     set ends_at = greatest(now(), starts_at + interval '1 microsecond'),
         reopened_at = now(),
         reopened_by = auth.uid()
   where id = v_closure.id
  returning * into v_closure;

  update public.shop_settings
     set closed_until = null, closure_message = null, closure_reason = null
   where id = 1;

  return jsonb_build_object('closure_id', v_closure.id, 'ends_at', v_closure.ends_at);
end;
$$;

-- Desk: tap-to-send message opened for an affected booking.
create or replace function public.desk_mark_closure_notified(p_impact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff();
  update public.closure_impacts set notified_at = now() where id = p_impact_id;
  if not found then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
end;
$$;

-- Desk: cancel an affected appointment (customer can't make another time).
-- Paid amounts are flagged for refund.
create or replace function public.desk_cancel_affected(p_impact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_impact public.closure_impacts;
  v_rows   integer;
  v_refund integer;
begin
  perform public.assert_staff();
  select * into v_impact from public.closure_impacts where id = p_impact_id;
  if v_impact.id is null or v_impact.appointment_id is null or v_impact.action <> 'appointment_affected' then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;

  update public.appointments set status = 'cancelled', hold_expires_at = null
   where id = v_impact.appointment_id and status in ('confirmed', 'checked_in', 'called');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  update public.payments set needs_refund = true
   where appointment_id = v_impact.appointment_id and status = 'paid';
  get diagnostics v_refund = row_count;

  return jsonb_build_object('cancelled', true, 'refund_flagged', v_refund > 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.closure_overlapping(timestamptz, timestamptz) from public, anon;
revoke execute on function public.shop_closed_now() from public;
revoke execute on function public.desk_close_shop(timestamptz, text, text) from public, anon;
revoke execute on function public.desk_reopen_shop() from public, anon;
revoke execute on function public.desk_mark_closure_notified(uuid) from public, anon;
revoke execute on function public.desk_cancel_affected(uuid) from public, anon;
revoke execute on function public.issue_queue_ticket(uuid, uuid[], uuid[], text, text, text, public.payment_option, text) from public, anon, authenticated;
revoke execute on function public.book_appointment(uuid, timestamptz, uuid[], uuid[], text, text, text, public.payment_option, text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid) from public, anon, authenticated;
revoke execute on function public.apply_checkout_result(text, boolean, text) from public, anon, authenticated;
revoke execute on function public.slot_conflict(uuid, timestamptz, timestamptz, uuid) from public, anon;

grant execute on function public.closure_overlapping(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.shop_closed_now() to anon, authenticated, service_role;
grant execute on function public.desk_close_shop(timestamptz, text, text) to authenticated;
grant execute on function public.desk_reopen_shop() to authenticated;
grant execute on function public.desk_mark_closure_notified(uuid) to authenticated;
grant execute on function public.desk_cancel_affected(uuid) to authenticated;
grant execute on function public.issue_queue_ticket(uuid, uuid[], uuid[], text, text, text, public.payment_option, text) to service_role;
grant execute on function public.book_appointment(uuid, timestamptz, uuid[], uuid[], text, text, text, public.payment_option, text) to service_role;
grant execute on function public.cancel_booking(uuid) to service_role;
grant execute on function public.apply_checkout_result(text, boolean, text) to service_role;
grant execute on function public.slot_conflict(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
