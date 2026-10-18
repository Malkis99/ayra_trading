/**
 * Cloud journal limits (T7b-3). They mirror migration 0004 on the server; the client checks first so a record the
 * server would reject is never sent. Change here (and in a new migration for the server side) — no app logic depends
 * on the exact numbers.
 */

/** Max size of one record (`data`) — PLACEHOLDER approved by the owner 2026-10-18 (0004: octet_length(data::text)). */
export const JOURNAL_CLOUD_MAX_RECORD_BYTES = 256 * 1024;

/** A record whose updatedAt is further in the future is rejected — PLACEHOLDER approved 2026-10-18 (0004: 5 minutes). */
export const JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Keys that never go into a cloud journal record: progress is server-only (ledger, migration 0007).
 * The server rejects the first six (0004); achievements and quests are dropped by the client as well.
 */
export const JOURNAL_CLOUD_FORBIDDEN_KEYS = [
  "xp",
  "coins",
  "xpAwarded",
  "coinsAwarded",
  "reward",
  "rewards",
  "achievements",
  "quests",
] as const;

/** How long a "sync on/off" answer from the server is trusted before asking again (turning the flag off = rollback). */
export const JOURNAL_CLOUD_FLAG_TTL_MS = 5 * 60 * 1000;

/** Pull re-reads this much before the last cursor: rows committed late by the server are not missed (merge is idempotent). */
export const JOURNAL_CLOUD_PULL_OVERLAP_MS = 60 * 1000;

/** Page size when reading changes from the server. */
export const JOURNAL_CLOUD_PAGE_SIZE = 500;
