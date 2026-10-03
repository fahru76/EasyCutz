---
title: "EZ-011: Service overrun — push delays to in-chair, walk-in and online customers"
labels: enhancement, bug, queue, booking, desk, notifications, priority:P1
depends_on: EZ-002, EZ-005
---
## Problem
When a cut runs longer than planned (difficult hair, customer changes style, late start), the delay doesn't reach everyone affected.

## Current behaviour (code, verified 2026-10-03)
| Who | Updated? | Detail |
| --- | --- | --- |
| In-chair customer / desk | ❌ | `minutesLeft` bottoms out at **0m left**; no "running over" state. |
| Walk-in queue ETA | ⚠️ partly | `src/lib/queue.ts` → `remainingMs` assumes **min 3 min left** once overrun (`MIN_REMAINING_MIN = 3`), so ETAs are recomputed every tick but are **systematically optimistic** and creep forward. |
| Online appointments | ❌ | Pass and desk always show the booked `starts_at`. There is no projected time and no delay notice. |

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

## Acceptance criteria
- [ ] A cut running 12 min over shows "+12m" on the desk within one tick (≤ 15 s), without a reload.
- [ ] With a barber overrun, every later booking for that barber shows a projected start pushed back by the same amount (unit tests: single overrun, cascade through 3 bookings, break in between, shift end).
- [ ] An appointment customer whose booking is delayed ≥ 5 min sees the new expected time on their pass, live.
- [ ] Checked-in customers are never dropped from the estimate because their booked time has passed (regression test for the bug above).
- [ ] "+10 min" from the desk immediately updates all affected ETAs and projected times.
- [ ] Desk lists delayed bookings ≥ 10 min with a ready-to-send message; re-prompts only when the delay grows by ≥ 10 min more.
- [ ] Delay ≥ 30 min: the message includes reschedule proposals (EZ-002) and the desk offers reassignment when another barber is free.
