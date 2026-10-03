-- =============================================================================
-- EasyCutz — business logic (authoritative server-side rules)
--
-- All pricing, durations, ticket numbering, slot validation and status
-- transitions are enforced here so a tampered client can never under-price a
-- cart, double-book a chair or skip the queue.
--
-- Errors are raised with a stable snake_case message that the API layer maps
-- to HTTP responses (see src/lib/server/errors.ts).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.shop_tz()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce((select timezone from public.shop_settings where id = 1), 'Asia/Kuala_Lumpur');
$$;

create or replace function public.shop_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone public.shop_tz())::date;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.assert_staff()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception using message = 'forbidden', errcode = '42501';
  end if;
end;
$$;

-- "Ahmad Rizal bin Ali" -> "Ahmad A."   |   "Jay" -> "Jay"
create or replace function public.make_display_name(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_parts text[];
  v_len   integer;
begin
  v_parts := regexp_split_to_array(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ' ');
  v_len := coalesce(array_length(v_parts, 1), 0);
  if v_len = 0 or v_parts[1] = '' then
    return 'Guest';
  elsif v_len = 1 then
    return left(v_parts[1], 20);
  end if;
  return left(v_parts[1], 20) || ' ' || upper(left(v_parts[v_len], 1)) || '.';
end;
$$;

-- Prices a cart from the live catalog. Rejects unknown / inactive / duplicate items.
create or replace function public.price_cart(
  p_service_ids uuid[],
  p_addon_ids   uuid[],
  out o_duration_min integer,
  out o_price_cents  integer,
  out o_summary      text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_service_ids uuid[] := coalesce(p_service_ids, '{}');
  v_addon_ids   uuid[] := coalesce(p_addon_ids, '{}');
  v_found       integer;
  v_add_dur     integer;
  v_add_price   integer;
  v_add_summary text;
begin
  if cardinality(v_service_ids) = 0 then
    raise exception using message = 'empty_cart', errcode = 'P0001';
  end if;
  if cardinality(v_service_ids) > 6 or cardinality(v_addon_ids) > 6 then
    raise exception using message = 'cart_too_large', errcode = 'P0001';
  end if;
  if (select count(distinct x) from unnest(v_service_ids) x) <> cardinality(v_service_ids)
     or (select count(distinct x) from unnest(v_addon_ids) x) <> cardinality(v_addon_ids) then
    raise exception using message = 'duplicate_items', errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(duration_min), 0), coalesce(sum(price_cents), 0),
         string_agg(name, ' + ' order by sort_order, name)
    into v_found, o_duration_min, o_price_cents, o_summary
    from public.services
   where id = any(v_service_ids) and is_active;
  if v_found <> cardinality(v_service_ids) then
    raise exception using message = 'unknown_service', errcode = 'P0001';
  end if;

  if cardinality(v_addon_ids) > 0 then
    select count(*), coalesce(sum(duration_min), 0), coalesce(sum(price_cents), 0),
           string_agg(name, ' + ' order by sort_order, name)
      into v_found, v_add_dur, v_add_price, v_add_summary
      from public.addons
     where id = any(v_addon_ids) and is_active;
    if v_found <> cardinality(v_addon_ids) then
      raise exception using message = 'unknown_addon', errcode = 'P0001';
    end if;
    o_duration_min := o_duration_min + v_add_dur;
    o_price_cents  := o_price_cents + v_add_price;
    o_summary      := o_summary || ' + ' || v_add_summary;
  end if;
end;
$$;

-- Amount to charge online right now for a given payment option.
create or replace function public.amount_due_now(p_price_cents integer, p_option public.payment_option)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_settings public.shop_settings;
begin
  select * into v_settings from public.shop_settings where id = 1;
  if p_option = 'cash_on_site' then
    return 0;
  elsif p_price_cents <= 0 then
    raise exception using message = 'nothing_to_charge', errcode = 'P0001';
  elsif p_option = 'full' then
    return p_price_cents;
  end if;
  -- deposit
  return least(
    p_price_cents,
    greatest(v_settings.min_deposit_cents, round(p_price_cents * v_settings.deposit_percent / 100.0)::integer)
  );
end;
$$;

-- Releases unpaid online-payment holds whose window has passed.
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
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mode B: issue a virtual walk-in ticket
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

  -- Serialise ticket numbering for the day.
  perform pg_advisory_xact_lock(hashtext('easycutz:queue:' || v_day::text));

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
-- Mode A: book a scheduled appointment
--   p_barber_id = null  -> first available barber for that exact slot.
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

  -- Candidate barbers: the requested one, or every barber ordered by lightest load that day.
  for v_candidate in
    select b.id
      from public.barbers b
     where b.is_active
       and (p_barber_id is null or b.id = p_barber_id)
       and exists (
         select 1 from public.barber_shifts s
          where s.barber_id = b.id
            and s.weekday = extract(dow from v_local_start)::smallint
            and s.start_time <= v_local_start::time
            and s.end_time   >= v_local_end::time
       )
       and not exists (
         select 1 from public.barber_time_off o
          where o.barber_id = b.id
            and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
       )
     order by (
       select count(*) from public.appointments a
        where a.barber_id = b.id
          and (a.starts_at at time zone v_tz)::date = v_local_start::date
          and a.status in ('pending_payment', 'confirmed', 'checked_in', 'called', 'in_chair', 'completed')
     ), b.sort_order, b.id
  loop
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
      exit; -- booked
    exception when exclusion_violation then
      v_appt := null; -- chair already taken for this window; try the next candidate
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
-- Customer self-cancel via secret pass token
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
    update public.queue_tickets set status = 'cancelled'
     where id = v_private.ticket_id and status in ('waiting', 'called');
  else
    update public.appointments set status = 'cancelled', hold_expires_at = null
     where id = v_private.appointment_id and status in ('pending_payment', 'confirmed', 'checked_in', 'called');
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  return jsonb_build_object('kind', v_private.kind, 'cancelled', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stripe: settle a Checkout Session (idempotent, called by the webhook)
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
    update public.queue_tickets
       set payment_status = case when p_paid then 'paid' else 'failed' end::public.payment_status
     where id = v_payment.ticket_id;
    return jsonb_build_object('outcome', v_outcome);
  end if;

  if p_paid then
    begin
      update public.appointments
         set payment_status = 'paid',
             status = case when status in ('pending_payment', 'expired') then 'confirmed' else status end::public.appointment_status,
             hold_expires_at = null
       where id = v_payment.appointment_id;
    exception when exclusion_violation then
      -- Paid after the hold lapsed and someone else took the chair: record it and flag for refund.
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
-- Quick-Desk (staff only)
-- ---------------------------------------------------------------------------
create or replace function public.chair_is_busy(p_barber_id uuid, p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.queue_tickets
     where barber_id = p_barber_id and status = 'in_chair' and id <> p_except
  ) or exists (
    select 1 from public.appointments
     where barber_id = p_barber_id and status = 'in_chair' and id <> p_except
  );
$$;

-- Calls the next customer for a chair: a due appointment first, otherwise the
-- oldest waiting ticket that asked for this barber or for "first available".
create or replace function public.desk_call_next(p_barber_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt   public.appointments;
  v_ticket public.queue_tickets;
begin
  perform public.assert_staff();

  if not exists (select 1 from public.barbers where id = p_barber_id and is_active) then
    raise exception using message = 'barber_unavailable', errcode = 'P0001';
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

  select * into v_ticket
    from public.queue_tickets
   where shop_day = public.shop_today()
     and status = 'waiting'
     and (preferred_barber_id = p_barber_id or preferred_barber_id is null)
   order by ticket_number
   limit 1
   for update skip locked;

  if v_ticket.id is null then
    return null;
  end if;

  update public.queue_tickets
     set status = 'called', called_at = now(), barber_id = p_barber_id
   where id = v_ticket.id;
  return jsonb_build_object('kind', 'ticket', 'id', v_ticket.id, 'label', v_ticket.code);
end;
$$;

-- Status transition for one booking.  actions: 'seat' | 'complete' | 'no_show' | 'requeue'
create or replace function public.desk_transition(
  p_kind      public.booking_kind,
  p_id        uuid,
  p_action    text,
  p_barber_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.queue_tickets;
  v_appt   public.appointments;
  v_barber uuid;
begin
  perform public.assert_staff();

  if p_action not in ('seat', 'complete', 'no_show', 'requeue') then
    raise exception using message = 'invalid_action', errcode = 'P0001';
  end if;

  if p_kind = 'ticket' then
    select * into v_ticket from public.queue_tickets where id = p_id for update;
    if v_ticket.id is null then
      raise exception using message = 'not_found', errcode = 'P0001';
    end if;

    if p_action = 'seat' then
      if v_ticket.status not in ('waiting', 'called') then
        raise exception using message = 'invalid_transition', errcode = 'P0001';
      end if;
      v_barber := coalesce(p_barber_id, v_ticket.barber_id, v_ticket.preferred_barber_id);
      if v_barber is null then
        raise exception using message = 'barber_required', errcode = 'P0001';
      end if;
      if public.chair_is_busy(v_barber, p_id) then
        raise exception using message = 'chair_busy', errcode = 'P0001';
      end if;
      update public.queue_tickets
         set status = 'in_chair', barber_id = v_barber, seated_at = now(), called_at = coalesce(called_at, now())
       where id = p_id;
    elsif p_action = 'complete' then
      if v_ticket.status <> 'in_chair' then
        raise exception using message = 'invalid_transition', errcode = 'P0001';
      end if;
      update public.queue_tickets set status = 'completed', completed_at = now() where id = p_id;
    elsif p_action = 'no_show' then
      if v_ticket.status not in ('waiting', 'called') then
        raise exception using message = 'invalid_transition', errcode = 'P0001';
      end if;
      update public.queue_tickets set status = 'no_show' where id = p_id;
    else -- requeue: put a called customer back into the waiting line
      if v_ticket.status <> 'called' then
        raise exception using message = 'invalid_transition', errcode = 'P0001';
      end if;
      update public.queue_tickets set status = 'waiting', called_at = null, barber_id = null where id = p_id;
    end if;
    return;
  end if;

  select * into v_appt from public.appointments where id = p_id for update;
  if v_appt.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;

  if p_action = 'seat' then
    if v_appt.status not in ('confirmed', 'checked_in', 'called') then
      raise exception using message = 'invalid_transition', errcode = 'P0001';
    end if;
    if public.chair_is_busy(v_appt.barber_id, p_id) then
      raise exception using message = 'chair_busy', errcode = 'P0001';
    end if;
    update public.appointments
       set status = 'in_chair', seated_at = now(), checked_in_at = coalesce(checked_in_at, now()),
           called_at = coalesce(called_at, now())
     where id = p_id;
  elsif p_action = 'complete' then
    if v_appt.status <> 'in_chair' then
      raise exception using message = 'invalid_transition', errcode = 'P0001';
    end if;
    update public.appointments set status = 'completed', completed_at = now() where id = p_id;
  elsif p_action = 'no_show' then
    if v_appt.status not in ('confirmed', 'checked_in', 'called') then
      raise exception using message = 'invalid_transition', errcode = 'P0001';
    end if;
    update public.appointments set status = 'no_show' where id = p_id;
  else
    if v_appt.status <> 'called' then
      raise exception using message = 'invalid_transition', errcode = 'P0001';
    end if;
    update public.appointments
       set status = case when checked_in_at is not null then 'checked_in' else 'confirmed' end::public.appointment_status,
           called_at = null
     where id = p_id;
  end if;
end;
$$;

-- Tablet / kiosk check-in by scanning the customer's pass QR code.
create or replace function public.desk_check_in(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private public.booking_private;
  v_label   text;
begin
  perform public.assert_staff();

  select * into v_private from public.booking_private where access_token = p_token;
  if v_private.id is null then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;

  if v_private.kind = 'ticket' then
    update public.queue_tickets
       set checked_in_at = coalesce(checked_in_at, now())
     where id = v_private.ticket_id and status in ('waiting', 'called')
    returning code into v_label;
  else
    update public.appointments
       set checked_in_at = coalesce(checked_in_at, now()),
           status = case when status = 'confirmed' then 'checked_in' else status end::public.appointment_status
     where id = v_private.appointment_id and status in ('confirmed', 'checked_in', 'called')
    returning display_name into v_label;
  end if;

  if v_label is null then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'kind', v_private.kind,
    'id', coalesce(v_private.ticket_id, v_private.appointment_id),
    'label', v_label,
    'customer_name', v_private.customer_name
  );
end;
$$;

create or replace function public.desk_mark_notified(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff();
  update public.queue_tickets set notified_at = now() where id = p_ticket_id;
  if not found then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.desk_set_duty(p_barber_id uuid, p_on_duty boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff();
  update public.barbers set is_on_duty = p_on_duty where id = p_barber_id and is_active;
  if not found then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
end;
$$;
