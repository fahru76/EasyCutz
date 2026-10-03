import "server-only";

import { AppError } from "./errors";

/**
 * Fixed-window, per-instance rate limiter for abuse protection on public
 * write endpoints. It is intentionally dependency-free; on multi-instance
 * hosting each instance enforces its own window, which is still an effective
 * brake on scripted ticket spam. Swap for a shared store (e.g. Upstash Redis)
 * if you need a global limit.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 10_000;

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return ip;
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AppError("rate_limited", 429, "Too many attempts. Please wait a minute and try again.");
  }
}
