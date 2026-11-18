/**
 * A sliding-window request limit per key (the user id), kept in this server instance's memory.
 *
 * Limitation: on Vercel every instance has its own memory, so the limit is per instance, not global. Enough for a
 * read-only shadow check (no money, no writes); a paying route (Q4.3) needs a shared limit (Postgres or a store).
 */
export interface RateLimiter {
  /** true = allowed (and counted); false = over the limit. `retryAfterSec` when refused. */
  take(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 10_000;
  return {
    take(key, nowMs) {
      const from = nowMs - opts.windowMs;
      const list = (hits.get(key) || []).filter((t) => t > from);
      if (list.length >= opts.limit) {
        hits.set(key, list);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + opts.windowMs - nowMs) / 1000)) };
      }
      list.push(nowMs);
      hits.delete(key); // re-insert: the map stays ordered by last use
      hits.set(key, list);
      // memory bound: forget the least recently used keys
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return { ok: true };
    },
  };
}
