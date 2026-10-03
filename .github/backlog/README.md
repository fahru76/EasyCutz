# EasyCutz backlog

Tickets raised 2026-10-03. Each file is a GitHub-issue-ready ticket; publish them with
`bash scripts/create-github-issues.sh` (add `--dry-run` first) after pushing the repo.

| ID | Ticket | Priority | Depends on |
| --- | --- | --- | --- |
| EZ-001 | Emergency shop open/close with impact handling | P1 | EZ-002 |
| EZ-002 | Reschedule flow + reschedule notifications | P1 | — |
| EZ-003 | Barber rest time (breaks, lunch, Friday prayers) | P1 | — |
| EZ-004 | Future booking — longer horizon, repeat booking, book-ahead queue | P2 | EZ-001 (holidays) |
| EZ-005 | 40-minute average cut time + learned durations for ETAs | P2 | — |
| EZ-006 | Kids cut — pricing/age rules, eligible barbers, family ticket | P3 | — |
| EZ-007 | Special services — hair dye / colour & chemical | P2 | — |
| EZ-008 | Hairstyle preference & reference photos | P2 | — |

Suggested order: EZ-002 → EZ-001 → EZ-003 → EZ-005 → EZ-007 → EZ-008 → EZ-004 → EZ-006.
