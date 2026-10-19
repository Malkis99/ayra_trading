import { AppStorage } from "@/lib/storage";
import type { JournalSnapshot } from "../types";
import type { ImportBatch } from "../import/batches";
import { JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS, JOURNAL_CLOUD_PULL_OVERLAP_MS, SYNC_BATCH_SIZE, SYNC_DEBOUNCE_MS, SYNC_LEASE_HEARTBEAT_MS, SYNC_PULL_INTERVAL_MS } from "./config";
import { SyncOutbox, outboxKey, type OutboxEntry } from "./outbox";
import { SyncLease } from "./lease";
import { isInitialSyncDone, markInitialSyncDone, writeSyncState } from "./sync-state";
import {
  JOURNAL_CLOUD_TABLES,
  decodeRow,
  encodeEntry,
  entryKey,
  entryVersion,
  snapshotEntries,
  type CloudEntry,
  type EncodeSkipReason,
  type JournalCloudReadRow,
  type JournalCloudTable,
  type JournalCloudWriteRow,
} from "./records";
import {
  applyEntries,
  planMerge,
  readBase,
  readConflicts,
  readCursor,
  updateBase,
  writeConflicts,
  writeCursor,
  type StoredConflict,
} from "./sync-merge";
import type { JournalCloudRemote } from "./remote";

/** Answer to "may this account use the cloud right now?" */
export type CloudReadiness = "on" | "off" | "unreachable" | "otherSession";

/**
 * - waitingInitialSync: the flag is on, but the first upload (4d) is not done — nothing is exchanged yet
 * - off: the flag is off (or the server refused because of it) — queue kept, nothing sent
 */
export type SyncEngineState = "idle" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error" | "off";

export interface LocalJournal {
  snapshot: JournalSnapshot;
  batches: ImportBatch[];
}

export interface SyncEngineDeps {
  remote: JournalCloudRemote;
  /** The journal of THIS account (explicit user, never "the current space"). */
  readJournal: (userId: string) => LocalJournal;
  writeJournal: (userId: string, journal: LocalJournal) => void;
  cloudReady: (userId: string) => Promise<CloudReadiness>;
  /** The server refused because sync is off: forget the cached "on". */
  onFlagOff?: (userId: string) => void;
  /** Records from the cloud were written into the local journal (the screen refreshes). */
  onRemoteApplied?: () => void;
  /** An empty device downloaded the cloud journal by itself (one notice "Journal loaded from the cloud"). */
  onCloudDownloaded?: (records: number) => void;
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
  conflicts: number;
  lastError?: string;
}

export type ConflictChoice = "device" | "cloud";

/** What the first sync will do (4d). */
export interface InitialSyncPlan {
  /** Live records only on this device, which can be sent. */
  toUpload: CloudEntry[];
  /** Live records only on this device that the server would refuse: shown with the reason, never block the rest. */
  skipped: { table: JournalCloudTable; id: string; reason: EncodeSkipReason }[];
  /** Cloud records missing here (taken as they are). */
  onlyCloud: CloudEntry[];
  /** Cloud versions of records that differ from this device (they become conflicts). */
  differ: CloudEntry[];
  /** Cloud versions equal to this device. */
  same: CloudEntry[];
  cursor: Partial<Record<JournalCloudTable, string>>;
  /** Live records in the cloud / on this device. */
  cloudLive: number;
  localLive: number;
}

export interface InitialSyncResult {
  uploaded: number;
  total: number;
  cancelled: boolean;
  downloaded: number;
  conflicts: number;
  skipped: InitialSyncPlan["skipped"];
}

const isTombstone = (e: CloudEntry) => Boolean(e.record.deletedAt || e.record.undoneAt);

/** JSON with sorted keys (the cloud database keeps fields in its own order). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Same contents in the cloud and here, apart from the time of the change (compared after a round trip through the cloud). */
function sameContents(local: CloudEntry, cloud: CloudEntry): boolean {
  const res = encodeEntry(local, null, new Date(8.64e15));
  if (!res.ok) return false;
  const back = decodeRow(local.table, { id: local.id, data: res.row.data, updated_at: "" });
  // only the time of the change differs (the same record saved on two devices): nothing to choose between
  const withoutTime = (r: Record<string, unknown>) => ({ ...r, updatedAt: undefined });
  return back.ok && stable(withoutTime(back.entry.record)) === stable(withoutTime(cloud.record));
}

/** Any live journal record of this account on this device. */
export function hasLiveData(journal: LocalJournal): boolean {
  const s = journal.snapshot;
  const lists = [s.accounts, s.trades, s.strategies, s.noTrades, s.plans, s.weekPlans, s.notes] as { deletedAt?: string | null }[][];
  return lists.some((l) => (l || []).some((r) => !r.deletedAt)) || journal.batches.some((b) => !b.undoneAt);
}

const isNetworkError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|offline|timed? ?out|abort/i.test(msg);
};
const isFlagOffError = (e: unknown) => (e as { code?: string })?.code === "42501";
/** lastError when the server refused a time from the future (0004): this device's clock is ahead. */
export const DEVICE_CLOCK_AHEAD = "deviceClockAhead";
const isFromFutureError = (e: unknown) => /journal_row_from_future/.test(e instanceof Error ? e.message : String(e));

/** The account changed (or the engine stopped) during an exchange: nothing more was sent or written. */
export class SyncAbortedError extends Error {
  name = "SyncAbortedError";
}
const Aborted = SyncAbortedError;

/**
 * Sync engine of ONE account: pull, then push (T7b-4a queue + T7b-4b pull and conflicts).
 *
 * Pull: records changed in the cloud since the last pull are merged by BASE version (sync-merge.ts) — taken when only
 * the cloud changed, kept when only this device changed, a conflict when both changed differently. Conflicts keep both
 * versions: the device version stays in the journal and is not sent, the cloud version is stored aside until the user
 * decides (dialog in 4c).
 * Push: queued records; the server's answer is checked — a version the server did not take becomes a conflict instead
 * of a silent "success".
 * Isolation: bound to its user; before every step and batch it checks this account is still the active one, and it reads
 * and writes only this account's space.
 */
export class JournalSyncEngine {
  readonly outbox: SyncOutbox;
  private readonly lease: SyncLease;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private parked = false;
  private state: SyncEngineState = "idle";
  private lastError?: string;
  private lastRun = { pulled: false, applied: 0 };
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
    return {
      state: this.state,
      pending: this.outbox.size(),
      blocked: this.outbox.blocked(),
      conflicts: Object.keys(readConflicts(this.userId)).length,
      lastError: this.lastError,
    };
  }

  isStopped(): boolean {
    return this.stopped;
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  /** Result of the last exchange: whether the pull went through and how many cloud records were taken. */
  lastRunResult(): { pulled: boolean; applied: number } {
    return { ...this.lastRun };
  }

  private setState(state: SyncEngineState, error?: string) {
    const changed = state !== this.state || error !== this.lastError;
    this.state = state;
    this.lastError = error;
    if (changed) this.deps.onChange?.();
  }

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
    // Changes made on other devices arrive even when nothing is edited here
    this.pullTimer = setInterval(() => void this.flush(), SYNC_PULL_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("pagehide", this.onPageHide);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.schedule();
  }

  /** Stops timers and gives up leadership. Queue, base versions and conflicts stay on the device for this account. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.pullTimer) clearInterval(this.pullTimer);
    this.timer = this.heartbeat = this.pullTimer = null;
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

  /** Resolves when the current exchange (if any) is over. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Pull, then send what is due (everything with `force`). One run at a time; never throws. */
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

  private offline(): boolean {
    return this.deps.isOnline?.() === false || (typeof navigator !== "undefined" && navigator.onLine === false);
  }

  private async run(force: boolean): Promise<void> {
    this.lastRun = { pulled: false, applied: 0 };
    if (!this.stillActive()) return;
    if (!this.lease.tryAcquire()) return this.park(); // another tab of this account exchanges
    const dueAt = force ? Infinity : this.now();
    if (this.offline()) {
      this.outbox.markFailed(this.outbox.due(dueAt), "offline", this.now(), this.deps.random);
      return this.setState("offline");
    }
    const ready = await this.deps.cloudReady(this.userId);
    if (!this.stillActive()) return;
    if (ready === "off") return this.park("off");
    if (ready === "otherSession") return this.park();
    // First sync: an empty device downloads the cloud journal by itself; with local data it waits for the button
    if (!isInitialSyncDone(this.userId) && !(await this.autoInitial())) return this.park("waitingInitialSync");
    if (ready === "unreachable") {
      this.outbox.markFailed(this.outbox.due(dueAt), "unreachable", this.now(), this.deps.random);
      return this.setState("offline");
    }

    this.setState("syncing");
    try {
      await this.pull();
      this.lastRun.pulled = true;
      await this.push(dueAt);
    } catch (e) {
      if (e instanceof Aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      if (isFlagOffError(e)) {
        this.deps.onFlagOff?.(this.userId);
        return this.park("off", message);
      }
      // Records stay queued and are retried with growing pauses; once the clock is right they get a sane time
      if (isFromFutureError(e)) return this.setState("error", DEVICE_CLOCK_AHEAD);
      return this.setState(isNetworkError(e) ? "offline" : "error", message);
    }
    if (!this.stillActive()) return;
    writeSyncState(this.userId, { lastSyncAt: new Date(this.now()).toISOString() });
    const conflicts = readConflicts(this.userId);
    this.setState(this.outbox.due(Infinity).some((e) => !conflicts[outboxKey(e)]) ? "syncing" : "synced");
  }

  private guard(): void {
    if (!this.stillActive()) throw new Aborted();
  }

  /** Reads what changed in the cloud since the last pull and merges it (never into another account). */
  private async pull(): Promise<void> {
    const cursor = readCursor(this.userId);
    const nextCursor = { ...cursor };
    const rows: { table: JournalCloudTable; row: JournalCloudReadRow }[] = [];
    for (const table of JOURNAL_CLOUD_TABLES) {
      const since = cursor[table] ? new Date(Date.parse(cursor[table]!) - JOURNAL_CLOUD_PULL_OVERLAP_MS).toISOString() : null;
      const page = await this.deps.remote.fetchSince(table, since);
      this.guard(); // the account may have changed while waiting: stop before touching anything
      for (const row of page) {
        rows.push({ table, row });
        if (!nextCursor[table] || row.updated_at > nextCursor[table]!) nextCursor[table] = row.updated_at;
      }
    }
    this.merge(rows);
    writeCursor(this.userId, nextCursor);
  }

  /** Merges cloud rows into this account's journal by base version. */
  private merge(rows: { table: JournalCloudTable; row: JournalCloudReadRow }[]): void {
    const remote: CloudEntry[] = [];
    for (const { table, row } of rows) {
      const res = decodeRow(table, row);
      if (res.ok) remote.push(res.entry); // records of a newer app version are left alone
    }
    if (!remote.length) return;
    this.guard();
    const journal = this.deps.readJournal(this.userId);
    const local = new Map(snapshotEntries(journal.snapshot, journal.batches).map((e) => [entryKey(e), e]));
    const conflicts = readConflicts(this.userId);
    const plan = planMerge({
      local,
      base: readBase(this.userId),
      pending: new Set(this.outbox.list().map(outboxKey)),
      conflicts: new Set(Object.keys(conflicts)),
      remote,
    });
    const at = new Date(this.now()).toISOString();
    for (const c of plan.conflicts) conflicts[entryKey(c)] = { table: c.table, id: c.id, cloud: c.record, detectedAt: at };
    for (const c of plan.conflictUpdates) conflicts[entryKey(c)] = { ...conflicts[entryKey(c)], cloud: c.record };
    this.guard();
    if (plan.take.length) this.deps.writeJournal(this.userId, applyEntries(journal.snapshot, journal.batches, plan.take));
    if (plan.conflicts.length || plan.conflictUpdates.length) writeConflicts(this.userId, conflicts);
    updateBase(this.userId, plan.base);
    // Equal versions and conflicts leave the queue: nothing to send (a conflict is sent only after the user decides)
    const leave = new Set([...plan.settled, ...plan.conflicts.map(entryKey)]);
    if (leave.size) this.outbox.markSent(this.outbox.list().filter((e) => leave.has(outboxKey(e))));
    this.lastRun.applied += plan.take.length;
    if (plan.take.length) this.deps.onRemoteApplied?.();
    if (plan.conflicts.length) this.deps.onChange?.();
  }

  private async push(dueAt: number): Promise<void> {
    const conflicts = readConflicts(this.userId);
    const due = this.outbox.due(dueAt).filter((e) => !conflicts[outboxKey(e)]);
    if (!due.length) return;
    const journal = this.deps.readJournal(this.userId);
    const records = new Map(snapshotEntries(journal.snapshot, journal.batches).map((e) => [entryKey(e), e]));
    const deviceId = this.deviceId();
    const base = readBase(this.userId);
    const byTable = new Map<JournalCloudTable, { entry: CloudEntry; version: string; row: JournalCloudWriteRow }[]>();
    const gone: OutboxEntry[] = [];
    const restamped: CloudEntry[] = [];
    for (const item of due) {
      let entry = records.get(outboxKey(item));
      if (!entry) {
        gone.push(item); // the record no longer exists on this device (data cleared): nothing to send
        continue;
      }
      // "From the future" is judged against the latest known time of this record: an edit made right after a cloud
      // version on a device whose clock is behind is stamped after that version — not a wrong clock ahead.
      const baseTime = Date.parse((base[entryKey(entry)] ?? "").split("|")[0]);
      const reference = Number.isNaN(baseTime) ? this.now() : Math.max(this.now(), baseTime);
      // A time further ahead than any known time was written while this device's clock was ahead (now corrected).
      // The server never stored it (0004 refuses it); give the record a sane time so it can be sent and later
      // updated by other devices, instead of blocking it.
      const changedAt = Date.parse(String(entry.record.updatedAt ?? ""));
      if (!Number.isNaN(changedAt) && changedAt > reference + JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS) {
        const stamp = new Date(Math.max(this.now(), Number.isNaN(baseTime) ? 0 : baseTime + 1)).toISOString();
        entry = { ...entry, record: { ...entry.record, updatedAt: stamp, ...(entry.record.deletedAt ? { deletedAt: stamp } : {}) } };
        restamped.push(entry);
      }
      const res = encodeEntry(entry, deviceId, new Date(reference));
      if (!res.ok) {
        this.outbox.markBlocked(item, res.reason);
        continue;
      }
      byTable.set(entry.table, [...(byTable.get(entry.table) || []), { entry, version: entryVersion(entry), row: res.row }]);
    }
    this.outbox.markSent(gone);
    if (restamped.length) {
      this.deps.writeJournal(this.userId, applyEntries(journal.snapshot, journal.batches, restamped));
      this.outbox.enqueue(restamped.map((e) => ({ table: e.table, id: e.id, version: entryVersion(e) })), this.now(), 0);
      const fixed = new Map(restamped.map((e) => [entryKey(e), entryVersion(e)]));
      for (const items of byTable.values()) for (const c of items) if (fixed.has(entryKey(c.entry))) c.version = fixed.get(entryKey(c.entry))!;
    }

    for (const [table, items] of byTable) {
      for (let i = 0; i < items.length; i += SYNC_BATCH_SIZE) {
        const chunk = items.slice(i, i + SYNC_BATCH_SIZE);
        // Re-check before every batch: never send this account's records while another account is open
        this.guard();
        let written: Set<string>;
        try {
          written = new Set((await this.deps.remote.upsert(table, chunk.map((c) => c.row))).written);
        } catch (e) {
          this.outbox.markFailed(chunk.map(({ entry }) => entry), e instanceof Error ? e.message : String(e), this.now(), this.deps.random);
          throw e;
        }
        this.guard();
        const ok = chunk.filter((c) => written.has(c.entry.id));
        this.outbox.markSent(ok.map(({ entry, version }) => ({ table: entry.table, id: entry.id, version })));
        updateBase(this.userId, Object.fromEntries(ok.map((c) => [entryKey(c.entry), c.version])));
        // The server kept another version (ours was older): look at it — a conflict, never a silent success
        const refused = chunk.filter((c) => !written.has(c.entry.id)).map((c) => c.entry.id);
        if (refused.length) {
          const current = await this.deps.remote.fetchByIds(table, refused);
          this.guard();
          const base = readBase(this.userId);
          const restamp: CloudEntry[] = [];
          const others: { table: JournalCloudTable; row: JournalCloudReadRow }[] = [];
          for (const row of current) {
            const decoded = decodeRow(table, row);
            const mine = chunk.find((c) => c.entry.id === row.id)?.entry;
            // The cloud still holds the version we started from: ours is the newer edit, only this device's clock is
            // behind. Give it a time after the cloud version and send it again (never a silent loss).
            if (decoded.ok && mine && base[entryKey(mine)] === entryVersion(decoded.entry)) {
              const stamp = new Date(Math.max(this.now(), Date.parse(String(decoded.entry.record.updatedAt)) + 1)).toISOString();
              restamp.push({ ...mine, record: { ...mine.record, updatedAt: stamp, ...(mine.record.deletedAt ? { deletedAt: stamp } : {}) } });
            } else others.push({ table, row });
          }
          if (restamp.length) {
            const j = this.deps.readJournal(this.userId);
            this.deps.writeJournal(this.userId, applyEntries(j.snapshot, j.batches, restamp));
            this.enqueue(restamp);
          }
          this.merge(others);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ first sync (4d) */

  /** Reads every cloud row of this account (first sync only). */
  private async fetchAllCloud(): Promise<{ entries: Map<string, CloudEntry>; cursor: Partial<Record<JournalCloudTable, string>> }> {
    const entries = new Map<string, CloudEntry>();
    const cursor: Partial<Record<JournalCloudTable, string>> = {};
    for (const table of JOURNAL_CLOUD_TABLES) {
      const rows = await this.deps.remote.fetchSince(table, null);
      this.guard();
      for (const row of rows) {
        const res = decodeRow(table, row);
        if (res.ok) entries.set(entryKey(res.entry), res.entry);
        if (!cursor[table] || row.updated_at > cursor[table]!) cursor[table] = row.updated_at;
      }
    }
    return { entries, cursor };
  }

  /**
   * What the first sync will do, without changing anything: records only on this device (to upload), only in the cloud
   * (to download), on both and different (conflicts), and records that cannot be sent (too large / time from the future).
   */
  async analyzeInitial(): Promise<InitialSyncPlan> {
    this.guard();
    const ready = await this.deps.cloudReady(this.userId);
    this.guard();
    if (ready !== "on") throw new Error(ready === "unreachable" ? "offline" : ready);
    const { entries: cloud, cursor } = await this.fetchAllCloud();
    const journal = this.deps.readJournal(this.userId);
    const local = snapshotEntries(journal.snapshot, journal.batches);
    const localByKey = new Map(local.map((e) => [entryKey(e), e]));
    const deviceId = this.deviceId();
    const plan: InitialSyncPlan = { toUpload: [], skipped: [], onlyCloud: [], differ: [], same: [], cursor, cloudLive: 0, localLive: 0 };
    for (const e of local) {
      if (isTombstone(e)) continue; // deleted records are not uploaded and not counted
      plan.localLive++;
      const c = cloud.get(entryKey(e));
      if (!c) {
        const res = encodeEntry(e, deviceId, new Date(this.now()));
        if (res.ok) plan.toUpload.push(e);
        else plan.skipped.push({ table: e.table, id: e.id, reason: res.reason });
      } else if (entryVersion(c) === entryVersion(e) || sameContents(e, c)) plan.same.push(c);
      else plan.differ.push(c);
    }
    for (const [key, c] of cloud) {
      if (!isTombstone(c)) plan.cloudLive++;
      const l = localByKey.get(key);
      if (!l) plan.onlyCloud.push(c);
      else if (isTombstone(l) && !isTombstone(c)) plan.differ.push(c); // deleted here before any sync, alive in the cloud
    }
    return plan;
  }

  /**
   * The first sync (by the button): downloads what is only in the cloud, keeps different records aside as conflicts
   * (nothing in the cloud is overwritten), uploads what is only here in batches. Idempotent by record id: after a
   * cancel, running again uploads only what is still missing. Never sends to or writes into another account.
   */
  async runInitial(opts: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean } = {}): Promise<InitialSyncResult> {
    writeSyncState(this.userId, { initialUploadStartedAt: new Date(this.now()).toISOString() });
    const plan = await this.analyzeInitial();
    if ((await this.deps.remote.currentUserId()) !== this.userId) throw new Aborted();
    this.guard();
    this.applyCloudSide(plan);

    const total = plan.toUpload.length;
    let done = 0;
    opts.onProgress?.(done, total);
    const deviceId = this.deviceId();
    const byTable = new Map<JournalCloudTable, CloudEntry[]>();
    for (const e of plan.toUpload) byTable.set(e.table, [...(byTable.get(e.table) || []), e]);
    for (const [table, items] of byTable) {
      for (let i = 0; i < items.length; i += SYNC_BATCH_SIZE) {
        if (opts.shouldCancel?.()) return { uploaded: done, total, cancelled: true, conflicts: plan.differ.length, skipped: plan.skipped, downloaded: plan.onlyCloud.length };
        this.guard(); // never send this account's records while another account is open
        const chunk = items.slice(i, i + SYNC_BATCH_SIZE);
        const rows = chunk.map((e) => encodeEntry(e, deviceId, new Date(this.now()))).filter((r) => r.ok).map((r) => (r as { row: JournalCloudWriteRow }).row);
        const written = new Set((await this.deps.remote.upsert(table, rows)).written);
        this.guard();
        const ok = chunk.filter((e) => written.has(e.id));
        updateBase(this.userId, Object.fromEntries(ok.map((e) => [entryKey(e), entryVersion(e)])));
        const okKeys = new Set(ok.map(entryKey));
        this.outbox.markSent(this.outbox.list().filter((q) => okKeys.has(outboxKey(q)) && q.version === entryVersion(ok.find((e) => entryKey(e) === outboxKey(q))!)));
        // Appeared in the cloud meanwhile (another device): the normal exchange sorts it out (conflict if different)
        const late = chunk.filter((e) => !written.has(e.id));
        if (late.length) this.enqueue(late);
        done += chunk.length;
        opts.onProgress?.(done, total);
      }
    }
    this.guard();
    writeCursor(this.userId, plan.cursor);
    markInitialSyncDone(this.userId, new Date(this.now()));
    this.deps.onChange?.();
    void this.flush(true);
    return { uploaded: done, total, cancelled: false, conflicts: plan.differ.length, skipped: plan.skipped, downloaded: plan.onlyCloud.length };
  }

  /** Cloud-only records are taken, equal ones get their base version, different ones become conflicts. */
  private applyCloudSide(plan: InitialSyncPlan): void {
    this.guard();
    const journal = this.deps.readJournal(this.userId);
    if (plan.onlyCloud.length) this.deps.writeJournal(this.userId, applyEntries(journal.snapshot, journal.batches, plan.onlyCloud));
    updateBase(this.userId, Object.fromEntries([...plan.onlyCloud, ...plan.same].map((c) => [entryKey(c), entryVersion(c)])));
    if (plan.differ.length) {
      const conflicts = readConflicts(this.userId);
      const at = new Date(this.now()).toISOString();
      for (const c of plan.differ) conflicts[entryKey(c)] = { table: c.table, id: c.id, cloud: c.record, detectedAt: at };
      writeConflicts(this.userId, conflicts);
    }
    const leave = new Set([...plan.same, ...plan.differ].map(entryKey));
    if (leave.size) this.outbox.markSent(this.outbox.list().filter((q) => leave.has(outboxKey(q))));
    if (plan.onlyCloud.length) this.deps.onRemoteApplied?.();
  }

  /**
   * Empty device (no journal of this account here): download the cloud journal by itself, once, and say so.
   * Nothing on either side: the first sync is simply done. Local data: wait for the button. Never throws.
   */
  private async autoInitial(): Promise<boolean> {
    try {
      const journal = this.deps.readJournal(this.userId);
      if (hasLiveData(journal)) return false;
      const plan = await this.analyzeInitial();
      this.guard();
      this.applyCloudSide(plan);
      writeCursor(this.userId, plan.cursor);
      markInitialSyncDone(this.userId, new Date(this.now()));
      if (plan.cloudLive > 0) this.deps.onCloudDownloaded?.(plan.cloudLive);
      return true;
    } catch (e) {
      if (!(e instanceof Aborted)) this.setState(isNetworkError(e) ? "offline" : "error", e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /* ------------------------------------------------------------------ conflicts (UI in 4c) */

  listConflicts(): StoredConflict[] {
    return Object.values(readConflicts(this.userId));
  }

  /**
   * "Keep this device": the device version gets a time later than the cloud one and is sent.
   * "Take from cloud": the cloud version replaces the device one (a deleted record disappears here as well).
   */
  resolveConflict(table: JournalCloudTable, id: string, choice: ConflictChoice): boolean {
    if (!this.stillActive()) return false;
    const conflicts = readConflicts(this.userId);
    const key = entryKey({ table, id });
    const c = conflicts[key];
    if (!c) return false;
    const cloud: CloudEntry = { table, id, record: c.cloud };
    const journal = this.deps.readJournal(this.userId);
    if (choice === "cloud") {
      this.deps.writeJournal(this.userId, applyEntries(journal.snapshot, journal.batches, [cloud]));
      this.outbox.markSent(this.outbox.list().filter((e) => outboxKey(e) === key));
    } else {
      const local = snapshotEntries(journal.snapshot, journal.batches).find((e) => entryKey(e) === key);
      if (!local) return false;
      const after = (iso: unknown) => (typeof iso === "string" && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) + 1 : 0);
      const stamp = new Date(Math.max(this.now(), after(c.cloud.updatedAt), after(local.record.updatedAt))).toISOString();
      const record = { ...local.record, updatedAt: stamp, ...(local.record.deletedAt ? { deletedAt: stamp } : {}) };
      const mine: CloudEntry = { ...local, record };
      this.deps.writeJournal(this.userId, applyEntries(journal.snapshot, journal.batches, [mine]));
      this.enqueue([mine]);
    }
    updateBase(this.userId, { [key]: entryVersion(cloud) });
    delete conflicts[key];
    writeConflicts(this.userId, conflicts);
    this.deps.onRemoteApplied?.();
    this.deps.onChange?.();
    return true;
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
