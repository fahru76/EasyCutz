---
title: "EZ-002: Reschedule flow + reschedule notifications"
labels: enhancement, db, booking, notifications, priority:P1
---
## Problem
Customers and staff can only **cancel**; there is no way to move a booking. When a barber is sick or the shop closes (EZ-001), the customer must rebook from scratch and loses any deposit linkage.

## Current behaviour (code)
- Customer actions on the pass: cancel / leave queue / complete payment only (`cancel_booking` RPC).
- Notifications are host-tapped WhatsApp/SMS deep links (`src/lib/notify.ts`) for "turn soon" and "called" only.

## Scope
- RPC `reschedule_appointment(p_token | p_id, p_new_starts_at, p_new_barber_id)` — atomic move inside one transaction, relying on the existing gist exclusion constraint; keeps the same pass token, payment and deposit.
- **Customer self-reschedule** on `/pass/<token>`: reuse `ScheduleStep` with the booked services pre-filled; cutoff configurable (`shop_settings.reschedule_cutoff_min`, default 120).
- **Desk-initiated reschedule**: pick new time/barber or send the customer a "pick a new time" link (pass page opens directly in reschedule mode).
- `booking_events` audit table (created, rescheduled_from/to, cancelled, notified) shown on desk + pass.
- Message templates in `notify.ts`: `rescheduledMessage`, `pleaseRescheduleMessage`, `closureMessage` (EZ-001), with the pass link.
- **Delivery (decided 2026-10-03): tap-to-send links only.** The host taps WhatsApp/SMS deep links on the desk (as today). No paid WhatsApp Business / SMS API. `booking_events` records when a message link was opened (`notified_at`) so the desk shows who has and hasn't been contacted.

### Dynamic reschedule proposals (decided 2026-10-03)
When an online booking is affected (shop closure EZ-001, barber sick/time off, desk "needs reschedule"), the system **proposes new dates/times automatically**:
- Function `propose_reschedule_slots(appointment_id, limit = 3)` reuses the slot engine with the booking's exact services and duration.
- Ranking: (1) same barber, same day, nearest time after the original; (2) same barber, next open days, closest to the original time of day; (3) any eligible barber, same ranking. Skip closures, breaks (EZ-003) and slots inside the minimum lead time.
- Proposals are stored as **soft holds** in `reschedule_offers (appointment_id, starts_at, barber_id, expires_at)`, default 24 h. They block those slots from other customers until they expire or the customer picks one. Expired offers are released by the same sweeper as `expire_stale_holds`.
- The message link opens `/pass/<token>?reschedule=1` showing the 3 proposals as one-tap buttons, plus "Pick another time" (the full slot picker).
- Accepting a proposal calls `reschedule_appointment`. The other offers are released and the deposit carries over.
- If no reply arrives before the offers expire, the booking stays in "Needs reschedule" on the desk; nothing is auto-cancelled.

## Status
**Delivered 2026-10-03** (branch `feat/ez-002-reschedule`, merged to `main`). Migration `20261003000006_reschedule.sql`.
- `do_reschedule` (atomic, keeps pass token, payment and deposit) with `reschedule_by_token` (customer, enforces `reschedule_cutoff_min`, default 120) and `desk_reschedule` (staff).
- `reschedule_offers`: soft holds (`offer_hold_hours`, default 24) that block the slot for other customers; created by `create_reschedule_offers`, released when the booking closes or the offer expires.
- `booking_events` audit table; shown on the pass.
- Dynamic proposals (`src/lib/reschedule.ts` + `proposeRescheduleSlots`): ranked by the real slot engine, same barber first, then nearest time; same-day "delay" / "early" proposals use only barbers on duty.
- Customer: "Reschedule" on the pass (opens on the booking's date; `?reschedule=1` opens it directly), one-tap accept of desk offers ("Move me earlier").
- Desk: Reschedule on every appointment row, on delayed bookings (≥ 30 min: emphasised, with proposals in the message) and on free-early chairs; tap-to-send confirmation banner after a move.
- Messages: `rescheduleOffersMessage`, `earlierSlotMessage`, `rescheduledMessage` (tap-to-send WhatsApp/SMS).
- Verified: SQL smoke section (cutoff, past time, other barber, overlap, offer holds) and browser E2E (desk offer → customer accepts; delay → move to another barber; customer self-picks a new time).

**Not built:** `closureMessage` (belongs with EZ-001).

## Acceptance criteria
- [ ] Customer can reschedule from the pass to any slot the engine offers; old window frees immediately; pass updates live.
- [ ] Concurrent reschedules to the same slot: exactly one wins, the other gets `slot_unavailable`.
- [ ] Deposit stays attached; no new Stripe session for an already-paid booking.
- [ ] Desk can send a reschedule request in one tap (WhatsApp/SMS deep link) that includes the proposed times.
- [ ] For an affected booking, 3 proposals are generated that respect closures, breaks, shifts and duration (unit tests on the ranking).
- [ ] Proposed slots are held and can't be booked by others until they expire (SQL test).
- [ ] Customer accepts a proposal in one tap from the pass; the old slot and the other offers are released.
- [ ] Unit + SQL tests for reschedule rules (cutoff, past time, other barber, overlap).

## Decisions
- 2026-10-03: messages go out via the existing **tap-to-send** WhatsApp/SMS links.
- 2026-10-03: the system **dynamically proposes** new dates/times for affected online bookings.
