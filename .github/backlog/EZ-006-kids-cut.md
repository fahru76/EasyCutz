---
title: "EZ-006: Kids cut — confirm pricing/age rules and make it prominent"
labels: enhancement, catalog, booking, priority:P3
---
## Current behaviour
A **Kids Cut (under 12)** service already exists in the seed (`kids-cut`, 30 min, RM 30) under *Haircuts*. It is not visually highlighted and there are no rules around it.

## Scope
- Confirm with the shop: price, duration, age limit, and which barbers do kids cuts (seed suggests Danial — "great with first haircuts").
- `services.barber_ids` restriction (or `barber_services` join table) so kids cuts are only offered with barbers who do them; "First Available" respects it.
- "Kids" badge + optional "Parent + Kid" combo (two people, one visit): booking 2 consecutive slots or 2 chairs in parallel.
- Walk-in: allow **one ticket for a parent + child** (party size 2) so families don't need two phones.

## Acceptance criteria
- [ ] Kids cut only bookable with eligible barbers (slot + SQL validation).
- [ ] Family ticket counts as 2 services in queue ETA.

## Open questions
- Final price/age limit? Is a parent+kid combo wanted?
