---
title: "EZ-007: Special services — hair dye / colour & chemical treatments"
labels: enhancement, catalog, db, booking, payments, priority:P2
---
## Problem
Colour, bleach, perm/keratin are long (90–180 min), priced by hair length, and need a consultation/patch test. The current model only has fixed price + fixed duration and four categories (`haircut, beard_shave, combo, scalp`).

## Scope
- Add category `colour` (enum migration) and service fields: `price_from_cents` + `price_note` ("from RM 120, final price after consultation"), `requires_deposit boolean`, `scheduled_only boolean`, `eligible barbers`.
- Variants by hair length (short / medium / long) → different duration + price; customer picks on the menu.
- **Scheduled only**: not offered in the live queue (long jobs would wreck walk-in ETAs).
- Mandatory deposit when `requires_deposit` (cash option hidden) — uses existing Stripe flow.
- Optional **processing-time gap**: colour processing (e.g. 30 min) during which the barber can take a short walk-in; modelled as `active_min / processing_min / active_min` segments in the slot engine (phase 2).
- Pre-booking questionnaire: current colour, last chemical treatment, allergies acknowledgement (stored in `booking_private`, staff-only).

## Acceptance criteria
- [ ] Customer sees "from RM X" and length variants; total shows "estimated".
- [ ] Colour services can't be added in walk-in mode.
- [ ] Deposit enforced server-side (`book_appointment` rejects `cash_on_site`).
- [ ] Desk shows the questionnaire on the booking.

## Open questions
- Menu & prices for colour services? Need patch-test 48 h before first colour?
