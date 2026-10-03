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

## Status
**Delivered 2026-10-04** (branch `feat/ez-003-breaks`, merged to `main`). Migration `20261003000008_barber_breaks.sql`.
- `barber_breaks` (recurring weekly, shop-local times; public read, owner write via `admin_save_break` / `admin_delete_break`, audited in the change log). Seed: staggered lunches (Aiman 13:00, Chandra 13:45, Bryan 14:00, Danial 15:00, 45 min) and Friday prayers 12:45–14:30 for everyone. Owner can edit all of it.
- Desk "Take a break" 10 / 15 / 30 min (`desk_take_break`, stored as `barber_time_off.kind = 'break'`), "Back now" (`desk_end_break`). Refused while a customer is in or called to the chair.
- `shop_settings.buffer_after_service_min` (0–30, default 0) kept free after every booking; editable under Fees & rules (which now also exposes the EZ-002 reschedule cutoff and offer hold).
- Booking side: `slot_conflict` (bookings, reschedules, offers) returns `break` for recurring breaks and applies the buffer; the slot engine and proposals skip breaks and keep the buffer.
- Queue side: the estimator treats breaks/time off as fixed blocks — walk-ins flow around them, bookings that fall in a break are pushed past it (and show as delayed), buffer after each service; state `on_break`.
- `desk_call_next` refuses with `on_break`, and only calls a walk-in that fits before the next booking **or** the next break.
- UI: customer roster badge "On Break · back hh:mm"; desk card shows the break and "back hh:mm", the upcoming break within an hour, and "Back now"; admin Breaks tab.
- Verified: SQL smoke section, 10 new unit tests (slots + estimator), browser E2E on a seeded scene.

**Not done:** shift-end overflow warning (from EZ-011's list); the desk "Seat" override still lets staff seat someone during a break on purpose.

## Acceptance criteria
- [x] No slot is offered that overlaps a recurring break or active time off (unit tests in `slots.test.ts`).
- [x] Walk-in ETA flows around breaks (new tests in `queue.test.ts`).
- [x] Customer roster shows "On Break · back hh:mm".
- [x] `book_appointment` rejects a crafted request inside a break (SQL smoke test).
