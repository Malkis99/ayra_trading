import { AppStorage } from "@/lib/storage";
import { SYNC_BATCH_SIZE, SYNC_DEBOUNCE_MS, SYNC_LEASE_HEARTBEAT_MS } from "./config";
import { SyncOutbox, outboxKey, type OutboxEntry } from "./outbox";
import { SyncLease } from "./lease";
import { isInitialSyncDone, writeSyncState } from "./sync-state";
import { encodeEntry, entryKey, entryVersion, type CloudEntry, type JournalCloudTable, type JournalCloudWriteRow } from "./records";
import type { JournalCloudRemote } from "./remote";

/** Answer to "may this account use the cloud right now?" */
export type CloudReadiness = "on" | "off" | "unreachable" | "otherSession";

/**
 * - waitingInitialSync: the flag is on, but the first upload (4d) is not done — changes only accumulate
 * - off: the flag is off (or the server refused because of it) — queue kept, nothing sent
 */
export type SyncEngineState = "idle" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error" | "off";

export interface SyncEngineDeps {
  remote: JournalCloudRemote;
  /** Every local record of THIS account (explicit user, never "the current space"). */
  readEntries: (userId: string) => CloudEntry[];
  cloudReady: (userId: string) => Promise<CloudReadiness>;
  /** The server refused because sync is off: forget the cached "on". */
  onFlagOff?: (userId: string) => void;
  tabId: string;
  now?: () => number;
  random?: () => number;
  isOnline?: () => boolean;
  onChange?: () => void;
}

export interface SyncEngineStatus {
  state: SyncEngineState;
  pending: number;
  blocked: OutboxEntry[];
  lastError?: string;
}

const isNetworkError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|offline|timed? ?out|abort/i.test(msg);
};
const isFlagOffError = (e: unknown) => (e as { code?: string })?.code === "42501";

/**
 * Sync engine of ONE account (T7b-4a): outbox, sending in batches, retries with growing pauses, one leader tab.
 * Bound to its user: before every step it checks that this account is still the active one and stops otherwise,
 * so records of one account can never be sent while another account is open.
 * Pull, base versions and conflicts — 4b; first upload — 4d.
 */
export class JournalSyncEngine {
  readonly outbox: SyncOutbox;
  private readonly lease: SyncLease;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private state: SyncEngineState = "idle";
  private lastError?: string;
  private readonly now: () => number;

  constructor(
    readonly userId: string,
    private readonly deps: SyncEngineDeps
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.outbox = new SyncOutbox(userId);
    this.lease = new SyncLease(userId, deps.tabId, this.now);
  }

  status(): SyncEngineStatus {
    return { state: this.state, pending: this.outbox.size(), blocked: this.outbox.blocked(), lastError: this.lastError };
  }

  isStopped(): boolean {
    return this.stopped;
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  private setState(state: SyncEngineState, error?: string) {
    const changed = state !== this.state || error !== this.lastError;
    this.state = state;
    this.lastError = error;
    if (changed) this.deps.onChange?.();
  }

  private parked = false;

  private park(state?: SyncEngineState, error?: string): void {
    this.parked = true;
    if (state) this.setState(state, error);
  }

  private stillActive(): boolean {
    if (this.stopped) return false;
    if (AppStorage.getUserId() !== this.userId) {
      this.stop();
      return false;
    }
    return true;
  }

  private onOnline = () => void this.flush();
  private onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void this.flush();
  };
  private onPageHide = () => this.lease.release();

  start(): void {
    if (this.heartbeat || this.stopped) return;
    this.heartbeat = setInterval(() => {
      if (!this.stillActive()) return;
      // Renew leadership; a follower takes over when the leader tab is gone
      if (this.lease.tryAcquire() && this.outbox.nextDueAt() !== null) this.schedule();
    }, SYNC_LEASE_HEARTBEAT_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("pagehide", this.onPageHide);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.schedule();
  }

  /** Stops timers and gives up leadership. The outbox stays on the device for the next session of this account. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = this.heartbeat = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("pagehide", this.onPageHide);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.lease.release();
  }

  /** Queues changed records (the newest version is read when sending). */
  enqueue(entries: CloudEntry[]): void {
    if (this.stopped || !entries.length) return;
    const now = this.now();
    this.outbox.enqueue(
      entries.map((e) => ({ table: e.table, id: e.id, version: entryVersion(e) })),
      now,
      now + SYNC_DEBOUNCE_MS
    );
    this.deps.onChange?.();
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const due = this.outbox.nextDueAt();
    if (due === null) return;
    this.timer = setTimeout(() => void this.flush(), Math.max(0, due - this.now()));
  }

  /** Resolves when the current send (if any) is over. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /**
   * Sends what is due (everything with `force`, e.g. "Retry now" or sign-out). One run at a time; never throws.
   */
  flush(force = false): Promise<void> {
    if (this.running) return this.running.then(() => (force ? this.flush(true) : undefined));
    this.parked = false;
    const run = this.run(force).finally(() => {
      this.running = null;
      // Nothing can progress now (waiting for the first sync, flag off, other tab leads): the heartbeat looks again
      if (!this.parked) this.schedule();
    });
    this.running = run;
    return run;
  }

  /** Sign-out / account switch: try to send for at most `ms`, then give up quietly (the queue stays). */
  async flushWithin(ms: number): Promise<void> {
    let t: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.flush(true), new Promise<void>((r) => (t = setTimeout(r, ms)))]);
    if (t) clearTimeout(t);
  }

  private async run(force: boolean): Promise<void> {
    if (!this.stillActive()) return;
    if (!this.outbox.size()) {
      if (this.state === "syncing") this.setState("synced");
      return;
    }
    if (!this.lease.tryAcquire()) return this.park(); // another tab of this account sends
    if (this.deps.isOnline?.() === false || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      this.outbox.markFailed(this.outbox.due(force ? Infinity : this.now()), "offline", this.now(), this.deps.random);
      return this.setState("offline");
    }

    const ready = await this.deps.cloudReady(this.userId);
    if (!this.stillActive()) return;
    if (ready === "off") return this.park("off");
    if (ready === "otherSession") return this.park();
    if (!isInitialSyncDone(this.userId)) return this.park("waitingInitialSync");
    const due = this.outbox.due(force ? Infinity : this.now());
    if (ready === "unreachable") {
      this.outbox.markFailed(due, "unreachable", this.now(), this.deps.random);
      return this.setState("offline");
    }
    if (!due.length) return;

    this.setState("syncing");
    const records = new Map(this.deps.readEntries(this.userId).map((e) => [entryKey(e), e]));
    const deviceId = this.deviceId();
    const byTable = new Map<JournalCloudTable, { entry: CloudEntry; version: string; row: JournalCloudWriteRow }[]>();
    const gone: OutboxEntry[] = [];
    for (const item of due) {
      const entry = records.get(outboxKey(item));
      if (!entry) {
        gone.push(item); // the record no longer exists on this device (data cleared): nothing to send
        continue;
      }
      const res = encodeEntry(entry, deviceId, new Date(this.now()));
      if (!res.ok) {
        this.outbox.markBlocked(item, res.reason);
        continue;
      }
      byTable.set(entry.table, [...(byTable.get(entry.table) || []), { entry, version: entryVersion(entry), row: res.row }]);
    }
    this.outbox.markSent(gone);

    for (const [table, items] of byTable) {
      for (let i = 0; i < items.length; i += SYNC_BATCH_SIZE) {
        const chunk = items.slice(i, i + SYNC_BATCH_SIZE);
        // Re-check before every batch: never send this account's records while another account is open
        if (!this.stillActive()) return;
        try {
          await this.deps.remote.upsert(table, chunk.map((c) => c.row));
          this.outbox.markSent(chunk.map(({ entry, version }) => ({ table: entry.table, id: entry.id, version })));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (isFlagOffError(e)) {
            this.deps.onFlagOff?.(this.userId);
            return this.park("off", message);
          }
          this.outbox.markFailed(chunk.map(({ entry }) => entry), message, this.now(), this.deps.random);
          return this.setState(isNetworkError(e) ? "offline" : "error", message);
        }
      }
    }
    if (!this.stillActive()) return;
    writeSyncState(this.userId, { lastSyncAt: new Date(this.now()).toISOString() });
    this.setState(this.outbox.due(Infinity).length ? "syncing" : "synced");
  }

  private deviceId(): string {
    const KEY = "ayra_sync_device_id";
    let id = AppStorage.getItem(KEY, this.userId);
    if (!id) {
      id = `dev_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      AppStorage.setItem(KEY, id, this.userId);
    }
    return id;
  }
}
