-- =============================================================================
-- BACKUP of the schema that existed in Supabase project lzvsaxedpryzomnxiewc
-- before the EasyCutz migrations were applied (captured 2026-10-03).
-- All six tables had 0 rows and there were 0 auth users at capture time.
-- RLS was enabled on every table with no policies. btree_gist, pgcrypto and
-- uuid-ossp extensions were installed (left in place).
-- To restore: run this file on an empty public schema (after dropping the new one).
-- =============================================================================

create type public.appointment_status as enum ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
create type public.queue_status as enum ('waiting', 'called', 'served', 'cancelled');

create table public.shop_settings (id uuid not null default gen_random_uuid(),
  name text not null default 'CutEasy'::text,
  timezone text not null default 'Asia/Kuala_Lumpur'::text,
  opening_time time without time zone not null default '09:00:00'::time without time zone,
  closing_time time without time zone not null default '20:00:00'::time without time zone,
  cancellation_window_minutes integer not null default 120,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now());

create table public.services (id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  duration_minutes integer not null,
  price_cents integer not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now());

create table public.staff (id uuid not null default gen_random_uuid(),
  user_id uuid,
  display_name text not null,
  avatar_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now());

create table public.seats (id uuid not null default gen_random_uuid(),
  label text not null,
  active boolean not null default true,
  created_at timestamp with time zone not null default now());

create table public.appointments (id uuid not null default gen_random_uuid(),
  service_id uuid not null,
  staff_id uuid not null,
  seat_id uuid,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  status public.appointment_status not null default 'pending'::appointment_status,
  service_name_snapshot text not null,
  duration_minutes_snapshot integer not null,
  price_cents_snapshot integer not null,
  confirmation_code text not null default encode(gen_random_bytes(9), 'hex'::text),
  idempotency_key uuid not null,
  created_at timestamp with time zone not null default now());

create table public.queue (id uuid not null default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  service_id uuid not null,
  staff_id uuid,
  status public.queue_status not null default 'waiting'::queue_status,
  joined_at timestamp with time zone not null default now(),
  called_at timestamp with time zone,
  served_at timestamp with time zone);

alter table public.shop_settings add constraint shop_settings_pkey PRIMARY KEY (id);
alter table public.shop_settings add constraint shop_settings_cancellation_window_minutes_check CHECK ((cancellation_window_minutes >= 0));
alter table public.services add constraint services_pkey PRIMARY KEY (id);
alter table public.services add constraint services_slug_key UNIQUE (slug);
alter table public.services add constraint services_duration_minutes_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 480)));
alter table public.services add constraint services_price_cents_check CHECK ((price_cents >= 0));
alter table public.staff add constraint staff_pkey PRIMARY KEY (id);
alter table public.staff add constraint staff_user_id_key UNIQUE (user_id);
alter table public.staff add constraint staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.seats add constraint seats_pkey PRIMARY KEY (id);
alter table public.seats add constraint seats_label_key UNIQUE (label);
alter table public.appointments add constraint appointments_pkey PRIMARY KEY (id);
alter table public.appointments add constraint appointments_idempotency_key_key UNIQUE (idempotency_key);
alter table public.appointments add constraint appointments_confirmation_code_key UNIQUE (confirmation_code);
alter table public.appointments add constraint appointments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id);
alter table public.appointments add constraint appointments_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES seats(id);
alter table public.appointments add constraint appointments_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id);
alter table public.appointments add constraint appointments_duration_minutes_snapshot_check CHECK ((duration_minutes_snapshot > 0));
alter table public.appointments add constraint appointments_check CHECK ((ends_at > starts_at));
alter table public.appointments add constraint appointments_price_cents_snapshot_check CHECK ((price_cents_snapshot >= 0));
alter table public.appointments add constraint appointments_active_overlap_excl EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((status = ANY (ARRAY['pending'::appointment_status, 'confirmed'::appointment_status])));
alter table public.queue add constraint queue_pkey PRIMARY KEY (id);
alter table public.queue add constraint queue_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id);
alter table public.queue add constraint queue_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id);

CREATE INDEX appointments_staff_time_idx ON public.appointments USING btree (staff_id, starts_at, ends_at);
CREATE INDEX appointments_status_time_idx ON public.appointments USING btree (status, starts_at);

alter table public.shop_settings enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.seats enable row level security;
alter table public.appointments enable row level security;
alter table public.queue enable row level security;

CREATE OR REPLACE FUNCTION public.cancel_appointment(p_appointment_id uuid, p_confirmation_code text)
 RETURNS TABLE(id uuid, service_id uuid, staff_id uuid, seat_id uuid, customer_name text, customer_phone text, customer_email text, starts_at timestamp with time zone, ends_at timestamp with time zone, status appointment_status, service_name_snapshot text, duration_minutes_snapshot integer, price_cents_snapshot integer, confirmation_code text, created_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_window integer;
begin
  if p_appointment_id is null or nullif(trim(p_confirmation_code), '') is null then
    raise exception using errcode = '22023', message = 'cancellation_credentials_required';
  end if;
  select a.* into v_appointment from public.appointments a
  where a.id = p_appointment_id and a.confirmation_code = trim(p_confirmation_code);
  if not found then raise exception using errcode = '22023', message = 'appointment_not_found'; end if;
  if v_appointment.status in ('cancelled', 'completed', 'no_show') then
    raise exception using errcode = '22023', message = 'appointment_not_cancellable';
  end if;
  select cancellation_window_minutes into v_window from public.shop_settings order by created_at limit 1;
  if v_appointment.starts_at <= now() + make_interval(mins => coalesce(v_window, 120)) then
    raise exception using errcode = '22023', message = 'cancellation_window_closed';
  end if;
  return query update public.appointments set status = 'cancelled' where id = v_appointment.id
  returning appointments.id, appointments.service_id, appointments.staff_id, appointments.seat_id,
    appointments.customer_name, appointments.customer_phone, appointments.customer_email,
    appointments.starts_at, appointments.ends_at, appointments.status,
    appointments.service_name_snapshot, appointments.duration_minutes_snapshot,
    appointments.price_cents_snapshot, appointments.confirmation_code, appointments.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_appointment(p_service_id uuid, p_staff_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, service_id uuid, staff_id uuid, seat_id uuid, customer_name text, customer_phone text, customer_email text, starts_at timestamp with time zone, ends_at timestamp with time zone, status appointment_status, service_name_snapshot text, duration_minutes_snapshot integer, price_cents_snapshot integer, confirmation_code text, created_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_service services%rowtype; v_end timestamptz; v_id uuid;
begin
  if p_idempotency_key is null then raise exception using errcode = '22023', message = 'idempotency_key_required'; end if;
  select * into v_service from public.services where id = p_service_id and active;
  if not found then raise exception using errcode = '22023', message = 'service_unavailable'; end if;
  select a.id into v_id from public.appointments a where a.idempotency_key = p_idempotency_key;
  if v_id is not null then return query select a.id, a.service_id, a.staff_id, a.seat_id, a.customer_name, a.customer_phone, a.customer_email, a.starts_at, a.ends_at, a.status, a.service_name_snapshot, a.duration_minutes_snapshot, a.price_cents_snapshot, a.confirmation_code, a.created_at from public.appointments a where a.id = v_id; return; end if;
  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);
  if p_starts_at <= now() then raise exception using errcode = '22023', message = 'past_start'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active) then raise exception using errcode = '22023', message = 'staff_unavailable'; end if;
  if exists (select 1 from public.appointments a where a.staff_id = p_staff_id and a.status in ('pending','confirmed') and a.starts_at < v_end and a.ends_at > p_starts_at) then raise exception using errcode = '23P01', message = 'slot_unavailable'; end if;
  return query insert into public.appointments (service_id, staff_id, customer_name, customer_phone, customer_email, starts_at, ends_at, service_name_snapshot, duration_minutes_snapshot, price_cents_snapshot, idempotency_key)
    values (p_service_id, p_staff_id, trim(p_customer_name), trim(p_customer_phone), nullif(trim(p_customer_email), ''), p_starts_at, v_end, v_service.name, v_service.duration_minutes, v_service.price_cents, p_idempotency_key)
    returning appointments.id, appointments.service_id, appointments.staff_id, appointments.seat_id, appointments.customer_name, appointments.customer_phone, appointments.customer_email, appointments.starts_at, appointments.ends_at, appointments.status, appointments.service_name_snapshot, appointments.duration_minutes_snapshot, appointments.price_cents_snapshot, appointments.confirmation_code, appointments.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_available_slots(p_service_id uuid, p_staff_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, staff_id uuid)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_duration integer; v_slot timestamptz; v_end timestamptz; v_open time; v_close time; v_timezone text;
begin
  if p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception using errcode = '22023', message = 'invalid_availability_range';
  end if;
  select duration_minutes into v_duration from public.services where id = p_service_id and active;
  if v_duration is null then raise exception using errcode = '22023', message = 'service_unavailable'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active) then
    raise exception using errcode = '22023', message = 'staff_unavailable';
  end if;
  select timezone, opening_time, closing_time into v_timezone, v_open, v_close
    from public.shop_settings order by created_at limit 1;
  v_slot := date_trunc('hour', p_from);
  while v_slot < p_to loop
    v_end := v_slot + make_interval(mins => v_duration);
    if v_slot > now()
       and (v_slot at time zone v_timezone)::time >= v_open
       and (v_end at time zone v_timezone)::time <= v_close
       and not exists (select 1 from public.appointments a
         where a.staff_id = p_staff_id and a.status in ('pending', 'confirmed')
           and a.starts_at < v_end and a.ends_at > v_slot) then
      starts_at := v_slot; ends_at := v_end; staff_id := p_staff_id; return next;
    end if;
    v_slot := v_slot + interval '30 minutes';
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_services()
 RETURNS TABLE(id uuid, slug text, name text, description text, duration_minutes integer, price_cents integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select s.id, s.slug, s.name, s.description, s.duration_minutes, s.price_cents
  from public.services s where s.active order by s.sort_order, s.name
$function$;

CREATE OR REPLACE FUNCTION public.list_staff()
 RETURNS TABLE(id uuid, display_name text, avatar_url text, active boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select s.id, s.display_name, s.avatar_url, s.active
  from public.staff s where s.active order by s.sort_order, s.display_name
$function$;
