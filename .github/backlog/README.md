# EasyCutz backlog

Tickets raised 2026-10-03. Each file is a GitHub-issue-ready ticket; publish them with
`bash scripts/create-github-issues.sh` (add `--dry-run` first) after pushing the repo.

| ID | Ticket | Priority | Depends on |
| --- | --- | --- | --- |
| EZ-001 | Emergency shop open/close with impact handling | P1 | EZ-002 |
| EZ-002 | Reschedule flow + reschedule notifications — **done** | P1 | — |
| EZ-003 | Barber rest time (breaks, lunch, Friday prayers) | P1 | — |
| EZ-004 | Future booking — longer horizon, repeat booking, **join tomorrow's queue today** | P2 | EZ-001 (holidays) |
| EZ-005 | 40-minute average cut time + learned durations for ETAs | P2 | — |
| EZ-006 | Kids cut — pricing/age rules, eligible barbers, family ticket | P3 | — |
| EZ-007 | Special services — hair dye / colour & chemical | P2 | — |
| EZ-008 | Hairstyle preference & reference photos | P2 | — |
| EZ-009 | Admin — edit services, add-ons and fees from the app — **done** | P1 | — |
| EZ-010 | Dual language — English + Bahasa Melayu | P2 | EZ-009 (BM menu fields) |
| EZ-011 | Service overrun **or early finish** — live per-barber timing (includes ETA bug fix, gap-aware Call Next) — **phases 1–2 done**; learned durations + breaks pending | P1 | EZ-002, EZ-005 |

Suggested order: EZ-009 → EZ-002 → EZ-001 → EZ-003 → EZ-005 → EZ-011 → EZ-010 → EZ-007 → EZ-008 → EZ-004 → EZ-006.

## Decisions log
- 2026-10-03 · EZ-001: emergency closure **cancels** waiting walk-in tickets.
- 2026-10-03 · EZ-002: notifications stay **tap-to-send** WhatsApp/SMS links; the system **dynamically proposes** new dates/times for affected online bookings.
- 2026-10-03 · EZ-004: "future booking" includes taking a ticket today for **tomorrow's** queue (confirmed).
- 2026-10-03 · EZ-006 / EZ-007: no changes to scope.
- 2026-10-03 · EZ-010: language pair **English + Bahasa Melayu** confirmed; BM copy written and approved by Fahru.
- 2026-10-03 · EZ-011: also covers **early finish**, calculated **per barber** (pull-forward is opt-in for booked customers).
