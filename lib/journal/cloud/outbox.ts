import { AppStorage } from "@/lib/storage";
import { SYNC_RETRY_DELAYS_MS, SYNC_RETRY_JITTER } from "./config";
import type { EncodeSkipReason, JournalCloudTable } from "./records";

/**
 * Outbox of one account on this device (T7b-4a): references to changed records, not copies.
 * The record itself is read from the local journal when it is sent, so ten edits of one trade = one entry and one send.
 * Stored in the account space (`ayra:<userId>:ayra_sync_outbox`); every method takes the user explicitly.
 */
export interface OutboxEntry {
  table: JournalCloudTable;
  id: string;
  /** Version of the record when it was last queued (updatedAt|deletedAt): a send removes the entry only for that version. */
  version: string;
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** The server would reject this record (too large / time from the future): kept, but not retried until it changes. */
  blocked?: EncodeSkipReason;
  /** A screenshot whose upload waits for «Continue» (0005-C): queued, not an error, not tried. */
  deferred?: "paused";
}

export const OUTBOX_KEY = "ayra_sync_outbox";

export const outboxKey = (e: { table: string; id: string }) => `${e.table}:${e.id}`;

/** Retry pause for the n-th failed attempt (1-based), with ±20% random spread. */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = SYNC_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 1), SYNC_RETRY_DELAYS_MS.length) - 1];
  return Math.round(base * (1 + (random() * 2 - 1) * SYNC_RETRY_JITTER));
}

export class SyncOutbox {
  constructor(readonly userId: string) {}

  list(): OutboxEntry[] {
    try {
      const raw = AppStorage.getItem(OUTBOX_KEY, this.userId);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(list: OutboxEntry[]): void {
    try {
      if (list.length) AppStorage.setItem(OUTBOX_KEY, JSON.stringify(list), this.userId);
      else AppStorage.removeItem(OUTBOX_KEY, this.userId);
    } catch {}
  }

  size(): number {
    return this.list().length;
  }

  /** Adds or refreshes entries; a new edit makes the record due again (after `dueAt`) and clears a block. */
  enqueue(items: { table: JournalCloudTable; id: string; version: string }[], now: number, dueAt: number): void {
    if (!items.length) return;
    const list = this.list();
    const index = new Map(list.map((e, i) => [outboxKey(e), i]));
    for (const it of items) {
      const i = index.get(outboxKey(it));
      if (i === undefined) {
        index.set(outboxKey(it), list.length);
        list.push({ table: it.table, id: it.id, version: it.version, enqueuedAt: now, attempts: 0, nextAttemptAt: dueAt });
      } else {
        list[i] = { ...list[i], version: it.version, attempts: 0, nextAttemptAt: dueAt, blocked: undefined, lastError: undefined, deferred: undefined };
      }
    }
    this.save(list);
  }

  /** Entries to send now (not blocked, pause over). */
  due(now: number): OutboxEntry[] {
    return this.list().filter((e) => !e.blocked && e.nextAttemptAt <= now);
  }

  /** Earliest time something becomes due, or null. */
  nextDueAt(): number | null {
    const times = this.list().filter((e) => !e.blocked).map((e) => e.nextAttemptAt);
    return times.length ? Math.min(...times) : null;
  }

  /** Sent: removed only if the record was not changed again meanwhile (otherwise the newer version is still due). */
  markSent(sent: { table: JournalCloudTable; id: string; version: string }[]): void {
    if (!sent.length) return;
    const done = new Map(sent.map((s) => [outboxKey(s), s.version]));
    this.save(this.list().filter((e) => done.get(outboxKey(e)) !== e.version));
  }

  markFailed(keys: { table: JournalCloudTable; id: string }[], error: string, now: number, random?: () => number): void {
    const failed = new Set(keys.map(outboxKey));
    this.save(
      this.list().map((e) => {
        if (!failed.has(outboxKey(e))) return e;
        const attempts = e.attempts + 1;
        return { ...e, attempts, lastError: error, nextAttemptAt: now + retryDelayMs(attempts, random) };
      })
    );
  }

  /** Not tried now and not a failure: due again at `until` (attempts unchanged); «paused» waits for «Continue». */
  defer(keys: { table: JournalCloudTable; id: string }[], until: number, reason?: "paused"): void {
    if (!keys.length) return;
    const set = new Set(keys.map(outboxKey));
    this.save(this.list().map((e) => (set.has(outboxKey(e)) ? { ...e, nextAttemptAt: until, deferred: reason } : e)));
  }

  /** «Continue» / «Retry»: these entries are due now, with a fresh count of attempts. */
  release(match: (e: OutboxEntry) => boolean, now: number): void {
    this.save(this.list().map((e) => (match(e) ? { ...e, nextAttemptAt: now, attempts: 0, lastError: undefined, deferred: undefined } : e)));
  }

  markBlocked(key: { table: JournalCloudTable; id: string }, reason: EncodeSkipReason): void {
    this.save(this.list().map((e) => (outboxKey(e) === outboxKey(key) ? { ...e, blocked: reason } : e)));
  }

  blocked(): OutboxEntry[] {
    return this.list().filter((e) => e.blocked);
  }

  clear(): void {
    this.save([]);
  }
}
