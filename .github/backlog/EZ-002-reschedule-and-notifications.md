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
- Optional phase 2: automated sending via WhatsApp Business Cloud API or Twilio from a Supabase Edge Function triggered by `booking_events` (needs business account + credentials — decision required).

## Acceptance criteria
- [ ] Customer can reschedule from the pass to any slot the engine offers; old window frees immediately; pass updates live.
- [ ] Concurrent reschedules to the same slot: exactly one wins, the other gets `slot_unavailable`.
- [ ] Deposit stays attached; no new Stripe session for an already-paid booking.
- [ ] Desk can send a reschedule request in one tap (WhatsApp/SMS deep link).
- [ ] Unit + SQL tests for reschedule rules (cutoff, past time, other barber, overlap).

## Open questions
- Automated messages (needs a paid WhatsApp Business / SMS provider) or keep host-tapped links?
