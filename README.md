# EasyCutz

Barbershop booking + live walk-in queue. Customers either **book an exact time** or **take a virtual queue number**, then follow a live digital pass. Staff run the floor from the **Quick-Desk**.

- **Stack:** Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · Framer Motion · Lucide · Zustand · Supabase (Postgres, Auth, Realtime) · Stripe Checkout (card + FPX, MYR)
- **Look:** dark luxury, zinc-950 with amber-500, Plus Jakarta Sans plus JetBrains Mono (self-hosted), mobile-first

## Features

| Area | What it does |
| --- | --- |
| Service menu | Tabs for Haircuts / Beard & Shave / Combos / Scalp Treatments. You can pick several services and toggle add-ons (Hot Towel, Charcoal Mask, Hair Wash…). Total time and price update live. |
| Barber roster | Swipeable cards showing rating, specialty and live status: *Available Now*, *In Chair · 15m left*, *Off Duty*. Includes a **First Available** option. |
| Mode A: scheduled | 14-day date strip that greys out closed days. Time slots only appear where the **whole cart duration** fits inside a shift without overlapping another booking. Double booking is blocked in the database by an exclusion constraint. |
| Mode B: live queue | Shows a live estimate (e.g. `~25 mins wait • 2 ahead`) and issues a ticket like `#B-14`. Status moves Waiting → In Chair → Completed. |
| Digital pass | `/pass/<token>`. Shows a QR code for check-in at the counter, a realtime timeline and ETA, and a "turn soon" alert (vibration plus browser notification). Customers can also share, cancel, leave the queue, or finish an unpaid payment. |
| Payments | Choose cash at the shop, a deposit (default 20%, min RM 10), or pay in full. Online payments go through Stripe Checkout (FPX + card). A webhook confirms the booking; slots are held for 30 minutes while payment is pending. |
| Quick-Desk | `/desk`. One card per chair with **Call Next · Seat Customer · Mark Complete · No Show**. Also: on/off duty toggles, the walk-in queue with WhatsApp/SMS "your turn is ~10 min away" links, today's bookings, and QR check-in (`/desk/checkin/<token>`). |

## Architecture

```
src/
  app/                 routes: / (booking), /pass/[token], /desk, /desk/login, /desk/checkin/[token]
    api/               availability · bookings · bookings/[token]/{cancel,pay} · stripe/webhook
  components/          booking/*, pass/DigitalPass, desk/*, ui/*
  hooks/               useLiveShop (Supabase Realtime), useNow
  lib/
    cart.ts            totals + deposit maths (mirrors SQL)
    slots.ts           duration-aware slot engine
    queue.ts           live ETA simulator (in-chair time left, called customers, appointment blocks)
    time.ts            timezone-safe helpers (shop timezone, never the browser's)
    server/            data access, zod validation, Stripe, errors, rate limiting, staff session
    supabase/          browser / server / admin clients
    types/             database.ts (Supabase types), domain.ts (app model + mappers)
  store/               Zustand booking cart
  proxy.ts             refreshes staff sessions for /desk
supabase/
  migrations/          schema · business-logic RPCs · RLS, grants, realtime
  seed.sql             starter menu, barbers, shifts
  tests/               vanilla-Postgres smoke tests (run-local.sh)
  legacy/              backup + removal script for the older schema found in the project
```

**Security model**

- `appointments` and `queue_tickets` hold no contact details, only names like "Ahmad R.". That lets anonymous visitors read them and stream them through Realtime.
- Phone, email and the secret pass token live in `booking_private`, which only staff can read (RLS).
- Every write goes through `SECURITY DEFINER` RPCs. Customer RPCs run only with the server's secret key, after zod validation and rate limiting. Desk RPCs check `is_staff()`.
- Prices and durations are always recalculated in SQL. The browser's numbers are never trusted.

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local   # Windows PowerShell: Copy-Item .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | API Keys → Publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | API Keys → Secret key (`sb_secret_…`). **Server only, never commit.** |
| `NEXT_PUBLIC_SITE_URL` | Your public URL in production (used for QR codes and links) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional. Without both, online payment options stay disabled. |

### 2. Database

**Option A: SQL Editor (simplest).** In Supabase → SQL Editor, run these in order:

1. `supabase/legacy/drop_previous_schema.sql`. Only needed if the project still has the older empty schema; the backup is in `supabase/legacy/`.
2. `supabase/migrations/20261003000001_schema.sql`
3. `supabase/migrations/20261003000002_functions.sql`
4. `supabase/migrations/20261003000003_security_realtime.sql`
5. `supabase/seed.sql`

**Option B: Supabase CLI.**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
psql "<connection string>" -f supabase/seed.sql
```

### 3. Create a staff login

In Supabase → Authentication → Users → *Add user*, create an email/password user. Then run this in the SQL Editor:

```sql
insert into public.staff (user_id, role, display_name)
select id, 'owner', 'Front Desk' from auth.users where email = 'you@example.com';
```

Then sign in at `/desk/login`.

### 4. Stripe (optional)

1. In Stripe, enable **FPX** (Malaysia) and set the account currency to MYR.
2. Add a webhook endpoint at `https://<your-domain>/api/stripe/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
3. Put the keys in `.env.local`. For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

If a customer pays after their 30-minute hold has lapsed and someone else has taken the slot, the payment is marked `needs_refund = true` in `payments`. Refund it from the Stripe dashboard.

### 5. Run

```bash
npm run dev         # http://localhost:3000
npm run build && npm start
```

## Quality checks

```bash
npm run check       # next typegen + tsc --noEmit, eslint, vitest (25 unit tests)
npm run test:db     # applies migrations + seed to a throwaway local Postgres and runs SQL smoke tests
                    # needs PostgreSQL 15+ binaries (Linux/macOS/WSL)
npm run test:db:week  # the same suite on every weekday at 10:00 and 23:50 shop-local (pinned clock)
                      # also needs libfaketime (apt-get install faketime); this is what CI runs
```

CI (`.github/workflows/check.yml`) runs `npm run check` and `npm run test:db:week` on every pull
request and every push to `main`.

## Customising

- **Menu, barbers, hours:** edit the rows in `services`, `addons`, `barbers` and `barber_shifts`. Weekdays run 0 = Sunday to 6 = Saturday, in shop-local time.
- **Rules:** `shop_settings` controls timezone, slot interval, booking horizon, minimum lead time, hold minutes (≥ 30), deposit %, minimum deposit, and the notify lead time.
- **Barber photos:** set `barbers.avatar_url`. Without one, a monogram is shown.

## Version control

```bash
git log --oneline              # history of this build
gh repo create easycutz --private --source . --remote origin --push
# or: git remote add origin https://github.com/<you>/easycutz.git && git push -u origin main
```
