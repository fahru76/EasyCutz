/**
 * Reschedule proposal ranking (EZ-002, used by EZ-011 for delays / early slots).
 *
 * Input: every free start time (per barber) the slot engine found for the
 * booking's exact duration. Output: the few best alternatives to offer.
 *
 * Ranking by reason
 * - default (closure, barber unavailable, manual):
 *     1. same barber, same day, nearest time AFTER the original
 *     2. same barber, next open days, closest to the original time of day
 *     3. any other eligible barber, same ordering
 *     4. same barber, same day, earlier than the original
 * - delay: other barbers at (about) the original time first, so the
 *   customer can keep their time with a free chair; then the default order.
 * - early: same barber, same day, earlier than the original, earliest first.
 * - barber_unavailable: the original barber is never proposed.
 *
 * Proposals are spread out (≥ minSpreadMin apart on the same day) so the
 * customer gets real choices instead of 2:30 / 2:45 / 3:00.
 */
import type { RescheduleReason } from "./types/database";

export interface RescheduleCandidate {
  /** ISO instant */
  startsAt: string;
  barberId: string;
  /** shop-local YYYY-MM-DD */
  date: string;
  /** minutes from shop-local midnight */
  localMinute: number;
}

export interface RescheduleOriginal {
  startsAt: string;
  barberId: string;
  date: string;
  localMinute: number;
}

export interface RankOptions {
  reason: RescheduleReason;
  limit?: number;
  minSpreadMin?: number;
}

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

type Score = [number, number, number];

function score(c: RescheduleCandidate, o: RescheduleOriginal, reason: RescheduleReason): Score | null {
  const sameBarber = c.barberId === o.barberId;
  const days = dayDiff(c.date, o.date);
  const delta = days === 0 ? c.localMinute - o.localMinute : 0;
  const todDistance = Math.abs(c.localMinute - o.localMinute);

  if (days < 0) return null;
  if (sameBarber && days === 0 && c.localMinute === o.localMinute) return null; // that's the current booking

  if (reason === "early") {
    if (!sameBarber || days !== 0 || delta >= 0) return null;
    return [0, c.localMinute, 0];
  }
  if (reason === "barber_unavailable" && sameBarber) return null;

  if (reason === "delay" && !sameBarber && days === 0 && Math.abs(delta) <= 15) {
    return [0, Math.abs(delta), 0];
  }

  const tierOffset = reason === "delay" ? 1 : 0;
  if (sameBarber) {
    if (days === 0 && delta > 0) return [tierOffset + 1, delta, 0];
    if (days > 0) return [tierOffset + 2, days, todDistance];
    return [tierOffset + 4, -delta, 0]; // same day, earlier
  }
  if (days === 0 && delta >= 0) return [tierOffset + 3, 0, delta];
  if (days > 0) return [tierOffset + 3, days, todDistance];
  return [tierOffset + 5, -delta, 0];
}

function compare(a: Score, b: Score): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function rankRescheduleProposals(
  candidates: readonly RescheduleCandidate[],
  original: RescheduleOriginal,
  options: RankOptions,
): RescheduleCandidate[] {
  const limit = options.limit ?? 3;
  const spread = options.minSpreadMin ?? (options.reason === "early" ? 15 : 30);

  const ranked = candidates
    .map((c) => ({ c, s: score(c, original, options.reason) }))
    .filter((x): x is { c: RescheduleCandidate; s: Score } => x.s !== null)
    .sort((a, b) => compare(a.s, b.s) || a.c.startsAt.localeCompare(b.c.startsAt) || a.c.barberId.localeCompare(b.c.barberId));

  const picked: RescheduleCandidate[] = [];
  for (const { c } of ranked) {
    if (picked.length >= limit) break;
    const tooClose = picked.some((p) => p.date === c.date && Math.abs(p.localMinute - c.localMinute) < spread);
    if (!tooClose) picked.push(c);
  }
  return picked;
}
