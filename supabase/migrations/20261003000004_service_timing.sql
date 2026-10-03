-- =============================================================================
-- EasyCutz — EZ-011 service timing: overruns, early finishes, delay notices
--
-- * expected_end_at: when the in-chair service is expected to finish. Set on
--   seating (seated_at + duration) and adjustable from the desk (+5/+10/+15,
--   "done in ~5"). The live estimator uses it as the source of truth.
-- * desk_call_next becomes gap-aware: a walk-in is only called if their
--   service fits before that barber's next booked appointment.
-- * delay_notified_*: lets the desk re-prompt only when a delay grows.
-- =============================================================================

alter table public.shop_settings
  add column if not exists delay_notify_min integer not null default 10 check (delay_notify_min between 1 and 120),
  add column if not exists early_offer_min  integer not null default 10 check (early_offer_min between 1 and 120);

alter table public.queue_tickets
  add column if not exists expected_end_at timestamptz;

alter table public.appointments
  add column if not exists expected_end_at    timestamptz,
  add column if not exists delay_notified_at  timestamptz,
  add column if not exists delay_notified_min integer check (delay_notified_min is null or delay_notified_min >= 0);

-- ---------------------------------------------------------------------------
-- expected_end_at is initialised whenever a booking enters the chair
-- ---------------------------------------------------------------------------
create or replace function public.set_expected_end_on_seat()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'in_chair' and (old.status is distinct from 'in_chair') then
    new.expected_end_at := coalesce(new.seated_at, now()) + make_interval(mins => new.duration_min);
  end if;
  return new;
end;
$$;

create trigger queue_tickets_expected_end before update on public.queue_tickets
  for each row execute function public.set_expected_end_on_seat();
create trigger appointments_expected_end before update on public.appointments
  for each row execute function public.set_expected_end_on_seat();

-- ---------------------------------------------------------------------------
-- Desk: adjust the expected end of the service in the chair
--   p_mode = 'extend'    -> push the end out by p_minutes (running over)
--   p_mode = 'finish_in' -> the barber will be done in p_minutes (early / on time)
-- ---------------------------------------------------------------------------
create or replace function public.desk_set_expected_end(
  p_kind    public.booking_kind,
  p_id      uuid,
  p_mode    text,
  p_minutes integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new timestamptz;
begin
  perform public.assert_staff();
  if p_mode not in ('extend', 'finish_in') or p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception using message = 'invalid_action', errcode = 'P0001';
  end if;

  if p_kind = 'ticket' then
    update public.queue_tickets
       set expected_end_at = case
             when p_mode = 'extend' then greatest(coalesce(expected_end_at, seated_at + make_interval(mins => duration_min)), now())
                                         + make_interval(mins => p_minutes)
             else now() + make_interval(mins => p_minutes)
           end
     where id = p_id and status = 'in_chair'
    returning expected_end_at into v_new;
  else
    update public.appointments
       set expected_end_at = case
             when p_mode = 'extend' then greatest(coalesce(expected_end_at, seated_at + make_interval(mins => duration_min)), now())
                                         + make_interval(mins => p_minutes)
             else now() + make_interval(mins => p_minutes)
           end
     where id = p_id and status = 'in_chair'
    returning expected_end_at into v_new;
  end if;

  if v_new is null then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk: record that a delay notice was sent for an appointment
-- ---------------------------------------------------------------------------
create or replace function public.desk_mark_delay_notified(p_appointment_id uuid, p_delay_min integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff();
  update public.appointments
     set delay_notified_at = now(), delay_notified_min = greatest(0, p_delay_min)
   where id = p_appointment_id;
  if not found then
    raise exception using message = 'not_found', errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- When this barber's chair will be free (now, or the expected end of the
-- current service, plus anyone already called for this chair).
-- ---------------------------------------------------------------------------
create or replace function public.chair_free_at(p_barber_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
           now(),
           coalesce((
             select max(coalesce(expected_end_at, seated_at + make_interval(mins => duration_min)))
               from (
                 select expected_end_at, seated_at, duration_min from public.queue_tickets
                  where barber_id = p_barber_id and status = 'in_chair'
                 union all
                 select expected_end_at, seated_at, duration_min from public.appointments
                  where barber_id = p_barber_id and status = 'in_chair'
               ) chair
           ), now())
         )
       + make_interval(mins => coalesce((
           select sum(duration_min)::integer from (
             select duration_min from public.queue_tickets
              where barber_id = p_barber_id and status = 'called'
             union all
             select duration_min from public.appointments
              where barber_id = p_barber_id and status = 'called'
           ) called
         ), 0));
$$;

-- ---------------------------------------------------------------------------
-- Gap-aware Call Next (replaces the version in 20261003000002_functions.sql)
--   1. a due appointment (within 10 min, or late) for this barber
--   2. otherwise the oldest eligible walk-in whose service FITS before this
--      barber's next booked appointment
--   3. if walk-ins wait but none fits: { kind: null, reason: 'no_fit', ... }
-- ---------------------------------------------------------------------------
create or replace function public.desk_call_next(p_barber_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt       public.appointments;
  v_ticket     public.queue_tickets;
  v_free_at    timestamptz;
  v_next       public.appointments;
  v_gap_min    integer;
  v_needed_min integer;
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

  v_gap_min := case
    when v_next.id is null then null
    else greatest(0, floor(extract(epoch from (v_next.starts_at - v_free_at)) / 60)::integer)
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
      'next_appointment_id', v_next.id,
      'next_label', v_next.display_name,
      'next_starts_at', v_next.starts_at
    );
  end if;

  update public.queue_tickets
     set status = 'called', called_at = now(), barber_id = p_barber_id
   where id = v_ticket.id;
  return jsonb_build_object('kind', 'ticket', 'id', v_ticket.id, 'label', v_ticket.code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.set_expected_end_on_seat() from public, anon, authenticated;
revoke execute on function public.desk_set_expected_end(public.booking_kind, uuid, text, integer) from public, anon;
revoke execute on function public.desk_mark_delay_notified(uuid, integer) from public, anon;
revoke execute on function public.chair_free_at(uuid) from public, anon;
grant execute on function public.desk_set_expected_end(public.booking_kind, uuid, text, integer) to authenticated;
grant execute on function public.desk_mark_delay_notified(uuid, integer) to authenticated;
grant execute on function public.chair_free_at(uuid) to authenticated, service_role;
grant execute on function public.desk_call_next(uuid) to authenticated;
