---
title: "EZ-010: Dual language — English + Bahasa Melayu"
labels: enhancement, i18n, ui, notifications, priority:P2
---
## Problem
Every screen, message and menu item is English only. Many customers prefer Bahasa Melayu.

## Current behaviour (code)
- All UI strings are hard-coded in components.
- Dates and times use `en-MY` formatting (`src/lib/time.ts`).
- WhatsApp/SMS templates in `src/lib/notify.ts` are English only.
- Service and add-on names are a single `name` / `description` column.

## Scope
- **Languages:** English (`en`) and Bahasa Melayu (`ms`); default follows the browser, falling back to English. _Assumed pair; confirm._
- **Language switch** (EN | BM) in the header, remembered in a cookie. No URL change needed. Optionally add `/ms` routes later for SEO.
- **UI strings:** move to typed dictionaries `src/i18n/en.ts` and `src/i18n/ms.ts`, where TypeScript enforces that every key exists in both. Load them server-side and pass them to client components. No heavy library is needed; `next-intl` is an option if plurals get complex.
- **Dates, times and money:** use the active locale (`ms-MY` / `en-MY`) in `formatClock`, `formatLongDate` and `formatDayLabel`. Currency stays `RM`.
- **Menu content:** add `name_ms` and `description_ms` (nullable; fall back to English) to `services` and `addons`, editable in the admin area (EZ-009).
- **Customer messages:** store `booking_private.language` at booking time. Desk WhatsApp/SMS links (turn soon, called, reschedule proposals from EZ-002, closure notices from EZ-001) use the customer's language, not the host's.
- **Pass page:** shows in the language the customer booked in, and can be switched.
- **Desk:** language is a per-staff preference.
- **Error messages:** `src/lib/server/errors.ts` returns codes; text comes from the dictionaries.

## Acceptance criteria
- [ ] Every customer-facing screen (booking, pass, errors, toasts) is fully translated; a CI check fails when a key is missing in either language.
- [ ] Switching language keeps the current cart and step.
- [ ] A customer who booked in BM receives BM WhatsApp/SMS templates from the desk.
- [ ] Dates and times read naturally in BM (e.g. "Selasa, 6 Oktober · 2:00 PTG").
- [ ] Service names fall back to English when no BM translation is entered.

## Open questions
- Confirm the language pair: English + Bahasa Melayu? (Chinese or Tamil could be added later using the same structure.)
- Who will provide or approve the BM copy?
