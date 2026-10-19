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

// ---- Sync engine (T7b-4, docs/t7b-4-sync-engine-plan.md section 8; PLACEHOLDERS approved by the owner 2026-10-18) ----

/** Pauses between retries of a failed send: 1 s, 5 s, 30 s, 2 min, then every 5 min. */
export const SYNC_RETRY_DELAYS_MS = [1000, 5000, 30_000, 120_000, 300_000] as const;

/** Random spread of every retry pause (±20%), so many devices do not retry at the same moment. */
export const SYNC_RETRY_JITTER = 0.2;

/** Wait after the last change before sending (several quick edits = one request). */
export const SYNC_DEBOUNCE_MS = 1000;

/** Records per request when sending (and, in 4d, uploading). */
export const SYNC_BATCH_SIZE = 100;

/** How long sign-out / account switch waits for the queue to be sent. */
export const SYNC_FLUSH_ON_SIGN_OUT_MS = 3000;

/** Only one tab of an account sends: lease TTL and renewal (same as the onboarding lease). */
export const SYNC_LEASE_TTL_MS = 15_000;
export const SYNC_LEASE_HEARTBEAT_MS = 5000;

/** Background pull of changes made on other devices (plan section 8: every 5 min, PLACEHOLDER approved 2026-10-18). */
export const SYNC_PULL_INTERVAL_MS = 5 * 60 * 1000;

/** "Sign out and delete data": how long "Wait for sending" waits (owner decision 2026-10-18: up to 30 s). */
export const SYNC_WAIT_BEFORE_DELETE_MS = 30_000;
