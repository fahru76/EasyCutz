---
title: "EZ-001: Emergency shop open/close with impact handling"
labels: enhancement, db, desk, booking, priority:P1
depends_on: EZ-002
---
## Problem
The shop sometimes has to close (or open late / close early) at short notice — power cut, flood, illness, family emergency. Today there is **no shop-level open/closed state**: only per-barber `is_on_duty` and per-barber `barber_time_off`. Closing means toggling every barber off by hand, and nothing happens to customers who already hold tickets or appointments.

## Current behaviour (code)
- `issue_queue_ticket` only refuses tickets when *no barber* is on duty (`shop_closed`).
- `book_appointment` / slot engine ignore any shop-wide closure; `barber_time_off` blocks new slots but **does not touch existing bookings**.
- No customer is told anything.

## Scope
- New table `shop_closures (id, starts_at, ends_at, reason, public_message, created_by, created_at)` + `shop_settings.is_open_override` (`open` | `closed` | null = follow schedule).
- Desk: **"Close shop now"** action with reason, until-time (end of day / custom) and customer-facing message; **"Reopen"** action.
- While closed: walk-in queue disabled, home hero shows banner with the public message, slot engine and `book_appointment` exclude the window (`shop_closed` error).
- Affected bookings list on the desk: every waiting/called ticket and every appointment overlapping the closure, with bulk actions **Notify all** (WhatsApp/SMS links, see EZ-002) and per-row **Offer reschedule / Cancel & refund flag**.
- **Walk-in tickets (decided 2026-10-03):** on closure every `waiting` / `called` ticket for today is **cancelled** automatically (`status = cancelled`, `cancel_reason = 'shop_closed'`). Prepaid tickets get `payments.needs_refund = true`. The desk shows them in a "Notify cancelled walk-ins" list with tap-to-send WhatsApp/SMS links.
- **Online bookings in the window:** not cancelled outright. The system generates new date/time proposals for each one (EZ-002) and the desk sends them with tap-to-send links. Paid/deposit bookings keep their payment if the customer accepts a proposal; otherwise `needs_refund = true`.

## Acceptance criteria
- [ ] Closing the shop from the desk stops new tickets and new bookings within 1 realtime tick (no reload).
- [ ] Customers on `/pass/<token>` see a "Shop temporarily closed" banner with the message and their options.
- [ ] Desk shows a count of affected bookings and every one can be notified in ≤ 2 taps.
- [ ] All waiting/called tickets for today become `cancelled` with reason `shop_closed`; the pass shows "Shop closed — your ticket was cancelled" plus a link to book or queue another day.
- [ ] Every affected online booking has proposals ready (EZ-002) before the host taps Notify.
- [ ] Reopening restores the queue; closure is kept as history.
- [ ] SQL smoke tests cover: closed → `shop_closed` on ticket + booking; overlap detection; reopen.

## Decisions
- 2026-10-03: waiting walk-in tickets are **cancelled** on emergency closure (not kept for reopening).
- 2026-10-03: notifications use the existing **tap-to-send** WhatsApp/SMS links (no paid messaging API).
