---
title: "EZ-011: Service overrun or early finish — live per-barber timing for in-chair, walk-in and online customers"
labels: enhancement, bug, queue, booking, desk, notifications, priority:P1
depends_on: EZ-002, EZ-005
---
## Problem
Service times drift **both ways**:
- a cut can **run over** (difficult hair, style change, late start);
- a cut can **finish early** (simple trim, fast barber, no-show before).

Either change must flow, **per barber**, to that barber's in-chair customer, called customer, booked appointments and walk-ins. It must not shift other barbers' fixed bookings. Only "First Available" walk-ins move between chairs, following whichever chair frees first.

## Current behaviour (code, verified 2026-10-03)
| Who | Updated? | Detail |
| --- | --- | --- |
| In-chair customer / desk | ❌ | `minutesLeft` bottoms out at **0m left**; no "running over" state. |
| Walk-in queue ETA | ⚠️ partly | `src/lib/queue.ts` → `remainingMs` assumes **min 3 min left** once overrun (`MIN_REMAINING_MIN = 3`), so ETAs are recomputed every tick but are **systematically optimistic** and creep forward. |
| Online appointments | ❌ | Pass and desk always show the booked `starts_at`. There is no projected time and no delay notice. |

### Early finish today
| Who | Updated? | Detail |
| --- | --- | --- |
| Walk-in queue ETA | ✅ | "Mark Complete" frees the chair immediately (`freeAt = now`), so ETAs shrink on the next tick. |
| Next booked customer of that barber | ❌ | Not told the barber is free; barber may idle until the booked time. |
| Desk "Call Next" | ⚠️ | `desk_call_next` takes the oldest eligible walk-in **without checking it fits before the barber's next appointment**. That can cause an overrun into the booking. Appointments are only prioritised when due within 10 min. |
| Learned speed | ❌ | A consistently fast barber keeps getting the generic duration (fixed by EZ-005). |

### Bug found
`buildChairs()` drops any confirmed/checked-in appointment whose start is more than `LATE_GRACE_MIN = 15` min in the past, treating it as a likely no-show. When the **barber** is the cause (chair still busy), a **checked-in** customer who is sitting in the shop gets ignored. Walk-in ETAs then come out too short, and that customer could be passed over.

## Scope
### 1. Overrun detection
- In-chair elapsed time > planned duration → state `running_over`.
  - Desk chair card: "**Running over +12m**" (amber, then red after 15 min).
  - Customer roster badge: "In Chair · running late".
- Better remaining-time guess when overrun:
  - use the barber's learned median for that service (EZ-005) when available;
  - otherwise use `max(5 min, 25% of planned)` instead of the fixed 3 min.
- Barber/host quick action on the desk: "**+5 / +10 / +15 min**" sets `expected_end_at` on the in-chair booking. The estimator uses it as the source of truth.

### 2. Projected times for everyone downstream
- Compute per barber, in order: the in-chair expected end → called customer → each upcoming appointment → walk-ins.
  - `projected_start = max(booked start, chair free time)`.
  - Delays **cascade** through every later booking for that barber.
  - Breaks (EZ-003) and shift end are respected.
- Pure function in `src/lib/queue.ts` (`projectChairTimeline`) shared by the pass, desk and home page, so every screen shows the same numbers.
- **Fix the bug:** never drop an appointment that is `checked_in` / `called`. The late-grace rule applies only when the customer has **not** checked in **and** the chair was free at their start time.

### 3. What customers see
- Walk-in pass: ETA uses the improved estimate; a small "Barber running ~10 min behind" note while overrun.
- Appointment pass: when projected start ≥ booked start + 5 min, show "**Running ~15 min late — expected 2:45 PM**" (live, updates as the chair frees).
- Home page roster and wait pill reflect the overrun.

### 4. Desk handling and notifications (tap-to-send, per EZ-002 decision)
- "**Delayed bookings**" panel: every appointment with delay ≥ `shop_settings.delay_notify_min` (default 10), with tap-to-send WhatsApp/SMS: "Hi Ben, Aiman is running about 15 min late — expected 2:45 PM. Live pass: …". Track `delay_notified_at` + notified delay so a second message is only prompted if the delay grows by another ≥ 10 min.
- When delay ≥ `delay_offer_reschedule_min` (default 30): offer the EZ-002 **dynamic reschedule proposals** in the same message.
- **Reassign suggestion:** if another eligible barber is free at the booked time, show "Move to Bryan (free now)". One tap reassigns via `reschedule_appointment` with the same time and a different barber.
- Projected end past shift end → warning on the chair card.

### 5. Early finish (per barber)
- **Ahead-of-schedule state:** when a booking completes before its planned end, or the projected timeline frees time before the next fixed booking, the chair card shows "**Free early · 18 min until Ben (2:45)**".
- **Gap-aware Call Next** (`desk_call_next` change, SQL):
  - pick the oldest eligible waiting ticket **whose duration fits before that barber's next appointment** (plus `buffer_after_service_min`, EZ-003);
  - if none fits, offer the appointment customer early (below) or show "Next walk-in needs 40 min, only 18 min free".
- **Pull the next booked customer forward (opt-in, never automatic):**
  - if that barber's next appointment customer is already **checked in**, the desk suggests "**Seat Ben now** (booked 2:45, already here)";
  - if not checked in and the free gap is ≥ `shop_settings.early_offer_min` (default 10), the desk offers a tap-to-send message: "Hi Ben, Aiman is free early — come in at 2:30 instead of 2:45? Confirm on your pass: …";
  - the pass shows "**Earlier time available: 2:30 PM — Move me earlier / Keep 2:45**". Accepting calls `reschedule_appointment` (EZ-002, same barber). The original slot is released only after acceptance.
- **"Finishing in ~5 min" button** on the chair card: sets `expected_end_at` earlier, so the next walk-in / booked customer can be called before the chair is actually free.
- **Walk-in ETAs** keep moving earlier automatically. "First Available" tickets re-flow to whichever chair frees first. Tickets with a preferred barber only follow that barber's timeline.
- Fast barbers get shorter learned durations (EZ-005), so their future ETAs start out accurate.

## Acceptance criteria
- [ ] A cut running 12 min over shows "+12m" on the desk within one tick (≤ 15 s), without a reload.
- [ ] With a barber overrun, every later booking for that barber shows a projected start pushed back by the same amount (unit tests: single overrun, cascade through 3 bookings, break in between, shift end).
- [ ] An appointment customer whose booking is delayed ≥ 5 min sees the new expected time on their pass, live.
- [ ] Checked-in customers are never dropped from the estimate because their booked time has passed (regression test for the bug above).
- [ ] "+10 min" from the desk immediately updates all affected ETAs and projected times.
- [ ] Desk lists delayed bookings ≥ 10 min with a ready-to-send message; re-prompts only when the delay grows by ≥ 10 min more.
- [ ] Delay ≥ 30 min: the message includes reschedule proposals (EZ-002) and the desk offers reassignment when another barber is free.
- [ ] Early finish: completing a booking 15 min early moves that barber's walk-in ETAs earlier within one tick. Other barbers' appointments are unchanged (unit test).
- [ ] Gap-aware Call Next never calls a walk-in whose service would run into that barber's next appointment (SQL smoke test with 18-min gap / 40-min service).
- [ ] A checked-in appointment customer is suggested for seating early when their barber frees up.
- [ ] A not-yet-arrived appointment customer can accept an earlier time from their pass in one tap; nothing moves without acceptance.
- [ ] All delay/early calculations are per barber; preferred-barber tickets follow only their barber's timeline.
