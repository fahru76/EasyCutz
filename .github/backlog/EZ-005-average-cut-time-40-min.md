---
title: "EZ-005: Use 40-minute average cut time + learn real durations for ETAs"
labels: enhancement, queue, db, priority:P2
---
## Problem
The shop's real average haircut is **40 minutes**. The estimator assumes **30** for a generic walk-in (`DEFAULT_WALK_IN_MIN = 30` in `src/lib/queue.ts`), and service durations are fixed seed values (Signature Cut 45). ETAs therefore drift.

## Scope
- `shop_settings.default_cut_min` (default **40**) replaces the hard-coded constant; exposed in the catalog.
- Review seeded durations against the 40-min reality (e.g. Signature Cut 40, Skin Fade 40–45).
- **Learned durations:** view `service_duration_stats` = median of `completed_at - seated_at` per (barber, service) over the last 60 days, min 10 samples, clamped to ±50% of the menu duration. Estimator uses learned value when available, menu value otherwise.
- Desk shows "avg 38m" per barber for transparency.
- Slots for *scheduled* bookings keep using menu durations (predictable for customers); learned values only affect **live queue ETAs**.

## Acceptance criteria
- [ ] With an empty queue and no history, a standard walk-in shows 40-min chunks per person ahead.
- [ ] With ≥ 10 completed samples, ETA uses the learned median (unit test with fixtures).
- [ ] Setting is editable without a deploy.
