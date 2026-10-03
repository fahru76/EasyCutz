---
title: "EZ-004: Future booking — longer horizon, repeat booking, book-ahead queue"
labels: enhancement, booking, priority:P2
---
## Problem
Scheduled booking already exists but only **14 days** ahead (`shop_settings.booking_horizon_days`, max 90) with a 14-chip date strip. Regulars want to book further out, and to re-book their usual cut after a visit.

## Scope
- Raise default horizon to 60 days; replace the chip strip with a **month calendar** (availability dots, closed days greyed) once horizon > 21 days.
- **"Book again"** on a completed pass: pre-fills same services + barber, suggests +3 / +4 / +6 weeks.
- Optional **"Remind me to rebook"** (stores preferred interval; host gets a list of due regulars on the desk).
- Holidays: `shop_closures` from EZ-001 used to grey out public holidays in advance.
- Guardrails: max N active future bookings per phone (default 2) to stop slot hoarding.

## Acceptance criteria
- [ ] Customer can book any open day up to the configured horizon on mobile in ≤ 3 taps after choosing services.
- [ ] "Book again" opens the flow pre-filled.
- [ ] Per-phone limit enforced in `book_appointment` (SQL test).
- [ ] A customer can take a ticket for the next open day; numbering, cap and one-per-phone are enforced in `issue_queue_ticket` (SQL tests).
- [ ] Pre-queued tickets not checked in by the grace deadline auto-flip to `no_show`.

## Decision (2026-10-03): join tomorrow's queue today
Customers can take a walk-in ticket **today for tomorrow's queue** (next open day).
- New walk-in option **"Queue for tomorrow"**. It shows the next open day (skipping closures/holidays) and its opening time.
- Tickets get `shop_day = next open day` and normal sequential numbering for that day. Pre-issued tickets are first in line at opening, in the order taken.
- Cap per day, `shop_settings.prequeue_limit` (default e.g. 10), so walk-ins arriving on the day still get a fair share. One pre-queued ticket per phone.
- Pre-queued customers must **check in within N minutes of opening** (`prequeue_checkin_grace_min`, default 30) or their ticket becomes `no_show`. The pass and the desk show the deadline.
- Their ETA starts counting at opening time. The estimator treats the day start as "now" for future `shop_day` tickets.
- If an emergency closure (EZ-001) hits that day, these tickets are cancelled like any other waiting ticket.

_Confirmed by the shop owner on 2026-10-03._
