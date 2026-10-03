---
title: "EZ-003: Barber rest time (breaks, lunch, Friday prayers)"
labels: enhancement, db, booking, desk, queue, priority:P1
---
## Problem
Shifts are one continuous block (`barber_shifts.start_time → end_time`). Barbers need recurring breaks (lunch, Friday prayers ~12:45–14:30, short rests between long services) and ad-hoc "taking a 15-min break now".

## Current behaviour (code)
- Slot engine blocks only appointments + `barber_time_off` (one-off).
- **The live-queue estimator (`src/lib/queue.ts`) ignores time off entirely** → walk-in ETAs are wrong when a barber is away.
- Desk has no "on break" state; only on/off duty.

## Scope
- `barber_breaks (barber_id, weekday, start_time, end_time, label)` for recurring breaks; seed lunch + Friday prayers.
- Desk button **"Take a break" (10 / 15 / 30 min)** → inserts `barber_time_off` from now; card shows "On break · back 2:45 PM" and the roster badge reads "On Break".
- Optional `shop_settings.buffer_after_service_min` (default 0) — rest/cleanup gap appended to each booking window.
- Feed breaks + time off into: `generateSlots`, `book_appointment` SQL validation, and **`buildChairs` in the queue estimator** as blocks.
- `desk_call_next` refuses to call for a barber currently on break.

## Acceptance criteria
- [ ] No slot is offered that overlaps a recurring break or active time off (unit tests in `slots.test.ts`).
- [ ] Walk-in ETA flows around breaks (new tests in `queue.test.ts`).
- [ ] Customer roster shows "On Break · back hh:mm".
- [ ] `book_appointment` rejects a crafted request inside a break (SQL smoke test).
