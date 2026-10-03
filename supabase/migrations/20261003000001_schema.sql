-- =============================================================================
-- EasyCutz — core schema
-- Barbershop catalog, roster, scheduled appointments and live walk-in queue.
--
-- Privacy model:
--   * `appointments` and `queue_tickets` hold NO contact details (only a short
--     display name such as "Ahmad R.") so they can be exposed read-only to the
--     anon role and streamed through Supabase Realtime.
--   * Contact details and the secret pass token live in `booking_private`,
--     readable only by staff (and the service role used by API routes).
-- =============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.service_category as enum ('haircut', 'beard_shave', 'combo', 'scalp');
create type public.ticket_status as enum ('waiting', 'called', 'in_chair', 'completed', 'no_show', 'cancelled');
create type public.appointment_status as enum (
  'pending_payment', 'confirmed', 'checked_in', 'called', 'in_chair', 'completed', 'no_show', 'cancelled', 'expired'
);
create type public.payment_option as enum ('cash_on_site', 'deposit', 'full');
create type public.payment_status as enum ('unpaid', 'pending', 'paid', 'failed', 'refunded');
create type public.booking_kind as enum ('appointment', 'ticket');
create type public.staff_role as enum ('owner', 'host', 'barber');

-- ---------------------------------------------------------------------------
-- Shop settings (singleton row, id = 1)
-- ---------------------------------------------------------------------------
create table public.shop_settings (
  id                   smallint primary key default 1 check (id = 1),
  shop_name            text        not null default 'EasyCutz',
  timezone             text        not null default 'Asia/Kuala_Lumpur',
  currency             text        not null default 'myr' check (currency = lower(currency) and length(currency) = 3),
  slot_interval_min    integer     not null default 15 check (slot_interval_min between 5 and 60),
  booking_horizon_days integer     not null default 14 check (booking_horizon_days between 1 and 90),
  min_lead_min         integer     not null default 30 check (min_lead_min >= 0),
  hold_minutes         integer     not null default 30 check (hold_minutes between 30 and 1440), -- Stripe Checkout sessions live >= 30 min
  deposit_percent      integer     not null default 20 check (deposit_percent between 1 and 100),
  min_deposit_cents    integer     not null default 1000 check (min_deposit_cents >= 200),
  notify_lead_min      integer     not null default 10 check (notify_lead_min between 1 and 60),
  shop_phone           text,
  shop_address         text,
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.services (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name         text not null,
  description  text not null default '',
  category     public.service_category not null,
  duration_min integer not null check (duration_min > 0 and duration_min <= 240),
  price_cents  integer not null check (price_cents >= 0),
  is_popular   boolean not null default false,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.addons (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name         text not null,
  description  text not null default '',
  duration_min integer not null default 0 check (duration_min >= 0 and duration_min <= 60),
  price_cents  integer not null check (price_cents >= 0),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------------
create table public.barbers (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  display_name  text not null,
  specialty     text not null default '',
  bio           text not null default '',
  avatar_url    text,
  rating        numeric(2,1) not null default 5.0 check (rating between 0 and 5),
  review_count  integer not null default 0 check (review_count >= 0),
  ticket_prefix char(1) not null unique check (ticket_prefix ~ '^[A-VX-Z]$'), -- 'W' is reserved for "first available"
  is_on_duty    boolean not null default false,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Weekly working pattern in shop-local wall-clock time. weekday: 0 = Sunday … 6 = Saturday.
create table public.barber_shifts (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.barbers(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time)
);
create index barber_shifts_barber_weekday_idx on public.barber_shifts (barber_id, weekday);

create table public.barber_time_off (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.barbers(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text not null default '',
  check (ends_at > starts_at)
);
create index barber_time_off_barber_idx on public.barber_time_off (barber_id, starts_at);

-- ---------------------------------------------------------------------------
-- Staff (maps Supabase Auth users to Quick-Desk access)
-- ---------------------------------------------------------------------------
create table public.staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  barber_id    uuid references public.barbers(id) on delete set null,
  role         public.staff_role not null default 'host',
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Scheduled appointments (Mode A)
-- ---------------------------------------------------------------------------
create table public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  barber_id             uuid not null references public.barbers(id),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  duration_min          integer not null check (duration_min > 0),
  price_cents           integer not null check (price_cents >= 0),
  service_ids           uuid[] not null,
  addon_ids             uuid[] not null default '{}',
  service_summary       text not null,
  display_name          text not null,
  status                public.appointment_status not null default 'confirmed',
  payment_option        public.payment_option not null default 'cash_on_site',
  payment_status        public.payment_status not null default 'unpaid',
  amount_due_now_cents  integer not null default 0 check (amount_due_now_cents >= 0),
  hold_expires_at       timestamptz,
  checked_in_at         timestamptz,
  called_at             timestamptz,
  seated_at             timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ends_at > starts_at),
  check (cardinality(service_ids) > 0),
  -- A barber can never hold two live bookings that overlap in time.
  constraint appointments_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending_payment', 'confirmed', 'checked_in', 'called', 'in_chair'))
);
create index appointments_starts_at_idx on public.appointments (starts_at);
create index appointments_barber_day_idx on public.appointments (barber_id, starts_at);

-- ---------------------------------------------------------------------------
-- Virtual walk-in tickets (Mode B)
-- ---------------------------------------------------------------------------
create table public.queue_tickets (
  id                    uuid primary key default gen_random_uuid(),
  shop_day              date not null,
  ticket_number         integer not null check (ticket_number > 0),
  code                  text not null,
  preferred_barber_id   uuid references public.barbers(id),
  barber_id             uuid references public.barbers(id),
  status                public.ticket_status not null default 'waiting',
  duration_min          integer not null check (duration_min > 0),
  price_cents           integer not null check (price_cents >= 0),
  service_ids           uuid[] not null,
  addon_ids             uuid[] not null default '{}',
  service_summary       text not null,
  display_name          text not null,
  payment_option        public.payment_option not null default 'cash_on_site',
  payment_status        public.payment_status not null default 'unpaid',
  amount_due_now_cents  integer not null default 0 check (amount_due_now_cents >= 0),
  checked_in_at         timestamptz,
  notified_at           timestamptz,
  called_at             timestamptz,
  seated_at             timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (shop_day, ticket_number),
  unique (shop_day, code),
  check (cardinality(service_ids) > 0)
);
create index queue_tickets_day_status_idx on public.queue_tickets (shop_day, status, ticket_number);

-- ---------------------------------------------------------------------------
-- Private booking data (contact details + pass token). Never exposed to anon.
-- ---------------------------------------------------------------------------
create table public.booking_private (
  id              uuid primary key default gen_random_uuid(),
  kind            public.booking_kind not null,
  appointment_id  uuid unique references public.appointments(id) on delete cascade,
  ticket_id       uuid unique references public.queue_tickets(id) on delete cascade,
  access_token    uuid not null unique default gen_random_uuid(),
  customer_name   text not null check (length(customer_name) between 1 and 80),
  phone           text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'), -- E.164
  email           text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  notes           text check (notes is null or length(notes) <= 500),
  created_at      timestamptz not null default now(),
  check (
    (kind = 'appointment' and appointment_id is not null and ticket_id is null) or
    (kind = 'ticket' and ticket_id is not null and appointment_id is null)
  )
);

-- ---------------------------------------------------------------------------
-- Payments (Stripe Checkout — card + FPX)
-- ---------------------------------------------------------------------------
create table public.payments (
  id                          uuid primary key default gen_random_uuid(),
  kind                        public.booking_kind not null,
  appointment_id              uuid references public.appointments(id) on delete set null,
  ticket_id                   uuid references public.queue_tickets(id) on delete set null,
  stripe_checkout_session_id  text not null unique,
  stripe_payment_intent_id    text,
  amount_cents                integer not null check (amount_cents > 0),
  currency                    text not null,
  status                      public.payment_status not null default 'pending',
  needs_refund                boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger barbers_touch before update on public.barbers
  for each row execute function public.touch_updated_at();
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();
create trigger queue_tickets_touch before update on public.queue_tickets
  for each row execute function public.touch_updated_at();
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();
create trigger shop_settings_touch before update on public.shop_settings
  for each row execute function public.touch_updated_at();
