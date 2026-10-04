-- =============================================================================
-- EasyCutz — desk_call_next consistency fixes (found by the eval harness, evals/)
--
-- The eval replays the desk rules against the live ETA estimator. Two places
-- where the desk and the estimator (and the customer's pass) disagreed:
--  1. A booking due within 10 minutes was called early even when the barber's
--     break starts before the booked time, pulling the customer into the break
--     while their pass said the barber was away. Now a booking is only called
--     early when no break starts before its booked time.
--  2. A walk-in was called if its cut fit before the next booking/break, but
--     the rest buffer (buffer_after_service_min, EZ-003) was ignored, so the
--     booked customer started late. Now cut + buffer must fit.
-- =============================================================================

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
  v_buffer_min  integer := coalesce((select buffer_after_service_min from public.shop_settings where id = 1), 0);
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
     -- never pull a booked customer forward into the barber's break
     and (starts_at <= now()
          or coalesce(public.next_break_start(p_barber_id, now()), 'infinity'::timestamptz) >= starts_at)
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
     and (v_gap_min is null or duration_min + v_buffer_min <= v_gap_min)
   order by ticket_number
   limit 1
   for update skip locked;

  if v_ticket.id is null then
    select min(duration_min) + v_buffer_min into v_needed_min
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

grant execute on function public.desk_call_next(uuid) to authenticated;
