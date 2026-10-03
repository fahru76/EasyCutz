---
title: "EZ-008: Hairstyle preference & reference photos (not just a standard cut)"
labels: enhancement, booking, desk, storage, priority:P2
---
## Problem
Customers want a *specific style* (mid fade, French crop, two-block, side part…), not "a haircut". Today there is only a free-text "Notes for your barber" field, which barbers often don't see at the chair.

## Scope
- **Style picker** step after services (optional, skippable): style gallery (shop-curated `styles` table: name, image, typical services), fade height (low/mid/high/skin), top length (guard / cm), finish (textured/neat/slick), beard shape.
- **Reference photo upload** (up to 3) to a private Supabase Storage bucket `style-refs`; signed URLs only for staff + the pass owner; auto-delete after 30 days.
- Stored as `booking_preferences` (staff-readable via RLS), linked to ticket/appointment.
- Desk chair card + called/in-chair view shows the style summary and thumbnails; tap to enlarge.
- **"Same as last time"**: returning phone numbers can reuse their previous preference (requires opt-in to remember).
- Styles can map to a service + extra duration (e.g. "Pompadour styling +10 min") so pricing/duration stay honest.

## Acceptance criteria
- [ ] Preferences + photos visible to the assigned barber on the desk within one realtime tick.
- [ ] Photos never publicly accessible (storage policy test).
- [ ] Booking still completes when the step is skipped.
- [ ] Image size limit (e.g. 5 MB, auto-resize on client).
