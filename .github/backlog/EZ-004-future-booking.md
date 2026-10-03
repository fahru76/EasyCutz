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

## Open questions
- Does "future booking" also mean **joining the live queue for later today** (e.g. "I'll come after 5 pm")? If yes, add a "not before" time to walk-in tickets.
