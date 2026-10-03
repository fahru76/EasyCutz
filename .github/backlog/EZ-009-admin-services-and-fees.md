---
title: "EZ-009: Admin — edit services, add-ons and fees from the app"
labels: enhancement, admin, db, catalog, priority:P1
---
## Problem
Only someone with Supabase access can change prices, durations or the menu (Table Editor / SQL). The shop owner can't adjust a fee, add a new service or hide one from the app.

## Current behaviour (code)
- `services`, `addons`, `shop_settings` are read-only to app users: `security_realtime` migration revokes insert/update/delete from `anon` and `authenticated`, and there are no admin RPCs.
- `staff.role` already has `owner | host | barber`, but nothing uses it yet.
- Bookings **snapshot** price, duration and summary at booking time (`appointments.price_cents`, `queue_tickets.price_cents`, `service_summary`), so editing the menu never changes existing bookings.

## Scope
- New **/desk/admin** area, visible to `owner` only (role check in UI and in every RPC via `assert_owner()`).
- **Services:** create, edit (name, description, category, duration, price, popular flag, sort order), activate/deactivate (soft delete only, never hard delete because bookings reference them), reorder by drag.
- **Add-ons:** same as services.
- **Fees & rules** (`shop_settings`): deposit %, minimum deposit, payment hold minutes, booking horizon, minimum lead time, slot interval. Validated with the same DB check constraints.
- **Scheduled price changes (optional):** `effective_from` so a new price starts on a chosen date.
- **Audit log:** `catalog_changes (who, when, table, row_id, before jsonb, after jsonb)`, shown in the admin area.
- Changes stream to customers through Realtime: the menu updates without a page reload. Add `services` and `addons` to the realtime publication.
- Preview "how the menu looks to customers" before saving.

## Status
**Delivered 2026-10-03** (branch `feat/ez-009-admin`, merged to `main`). Migration `20261003000005_admin_catalog.sql`.
- `is_owner()` / `assert_owner()`; owner-only RPCs `admin_save_service`, `admin_save_addon`, `admin_reorder`, `admin_update_settings` (allow-listed keys, DB check constraints still apply).
- `catalog_changes` audit table (who, when, before/after), shown in the "Change log" tab.
- `/desk/admin` (owner only; hosts and barbers see "Owner access only"): Services, Add-ons, Fees & rules (with live deposit preview), Change log. Reorder uses up/down buttons rather than drag. Deactivate is a soft delete.
- `services`, `addons` and `shop_settings` are in the realtime publication; the customer menu updates live and the cart drops items that become inactive.
- Verified: SQL smoke section, plus browser E2E (RM 50 → 55 shown on the menu, logged in the change log; deposit preview RM 12.50).

**Not built:** scheduled price changes (`effective_from`, optional), BM fields (EZ-010).

## Acceptance criteria
- [ ] An owner can change a service price and the booking page shows the new price within one realtime tick. Existing bookings keep their old price.
- [ ] Host/barber accounts can't see or call admin actions (RPC rejects with `forbidden`; SQL smoke test).
- [ ] Deactivated services disappear from the menu and are rejected by `price_cart`, but past bookings still display them.
- [ ] Invalid values (negative price, duration 0, deposit % > 100) are rejected by both the form and the database.
- [ ] Every change appears in the audit log with before/after values.

## Related
- EZ-007 (colour services) adds "from RM X" pricing and length variants; build the editor so those fields slot in.
- EZ-010 (dual language): the editor needs a second field for each name and description.
