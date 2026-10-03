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

## Status
**Delivered 2026-10-03** (branch `feat/ez-001-closure`, merged to `main`). Migration `20261003000007_shop_closure.sql`.
- `shop_closures` (history; reopening shortens `ends_at`, `reopened_at` kept) and `closure_impacts` (every affected booking, `notified_at`, payment flag; staff-only).
- Live public state on `shop_settings` (`closed_until`, `closure_message`, `closure_reason`), already in Realtime.
- `desk_close_shop(until, reason, message)`: any staff member; re-running changes the reopen time/message.
  - Today's waiting/called walk-ins → `cancelled`, `cancel_reason = 'shop_closed'`; paid ones → `payments.needs_refund`.
  - Appointments in the window keep their booking, get `reschedule_requested_at` (no cutoff), and the server holds up to 3 proposals each (EZ-002 offers, reason `closure`).
  - Unpaid payment holds in the window are released; other customers' open offers inside the window are released.
- While closed: `issue_queue_ticket` → `shop_closed`; `book_appointment` → `closed_window`; `slot_conflict` blocks every chair, so availability and proposals skip the window.
- Late Stripe payment for a ticket/hold released by a closure is flagged for refund instead of reviving the booking. Customer or desk cancel of an affected paid booking flags a refund.
- Desk: "Close shop (emergency)" form (reason chips, reopen presets from shifts or custom date/time, editable pre-filled message), closed banner with "Change time / message" and two-tap "Reopen now", affected-customers list with WhatsApp/SMS per row, "Message next" (one tap each), "Hold new times", "Cancel booking" (+ refund flag). Follow-up list stays 24 h after reopening.
- Home: closed banner; walk-in step shows "Live queue paused". Pass: cancelled-ticket notice with refund line and "Book or queue another day"; affected booking notice above the held times; others see the reopen time (and "isn't affected" when their booking is after it).
- Verified: SQL smoke section (close/extend/reopen, permissions, refunds, closed_window, offers released), 8 unit tests, browser E2E on a seeded scene against the local shim (no realtime there).

**Deviation from scope:** no `shop_settings.is_open_override` (open-on-a-closed-day). Closures are "close now until X" only; scheduled future closures and holidays belong with EZ-004.
**Not verified:** live Supabase Realtime push to customers (the shim has no realtime); the desk refreshes from the server after each action and polls every 30 s while a closure is active.

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
