import type {
  Account,
  JournalRepository,
  JournalSnapshot,
  Note,
  NoTradeEntry,
  StorageUsage,
  Strategy,
  Trade,
  TradingPlan,
  WeekPlan,
} from "../types";
import { LocalStorageJournalRepository } from "../repository";
import { listImportBatches, replaceImportBatches, subscribeImportBatches } from "../import/batches";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { JOURNAL_CLOUD_FLAG_TTL_MS, JOURNAL_CLOUD_PULL_OVERLAP_MS, SYNC_FLUSH_ON_SIGN_OUT_MS } from "./config";
import type { JournalCloudRemote } from "./remote";
import {
  JOURNAL_CLOUD_TABLES,
  changedEntries,
  decodeRow,
  importBatchEntries,
  mergeEntries,
  snapshotEntries,
  versionMap,
  type CloudEntry,
  type JournalCloudTable,
} from "./records";
import { JournalSyncEngine, type CloudReadiness, type SyncEngineState } from "./sync-engine";
import type { OutboxEntry } from "./outbox";
import { isInitialSyncDone } from "./sync-state";

const CURSOR_KEY = "ayra_journal_cloud_cursor";

/**
 * - local: cloud not used (guest, flag off, not configured)
 * - waitingInitialSync: flag on, first upload not done yet — changes wait in the queue (4d adds the button)
 * - syncing / synced / offline / error: state of the queue and of the last pull
 */
export type JournalCloudState = "local" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error";

export interface JournalCloudStatus {
  state: JournalCloudState;
  /** Changes waiting in the queue of the current account. */
  pending: number;
  /** Records the server would reject (too large / time from the future): kept locally, not retried until changed. */
  blocked: Pick<OutboxEntry, "table" | "id" | "blocked">[];
  lastError?: string;
}

export interface PullResult {
  /** false when the cloud was not used or the pull failed. */
  ok: boolean;
  applied: number;
}

const ENGINE_TO_CLOUD_STATE: Record<SyncEngineState, JournalCloudState> = {
  idle: "synced",
  waitingInitialSync: "waitingInitialSync",
  syncing: "syncing",
  synced: "synced",
  offline: "offline",
  error: "error",
  off: "local",
};

let tabCounter = 0;

/**
 * Cloud journal behind the same JournalRepository interface (T7b-3; outbox and retries since T7b-4a).
 *
 * The local repository stays the working copy: every read is local and synchronous, every write goes to the
 * local journal first. Changed records of an account go into that account's outbox on this device; a sync engine
 * per account sends them (only when cloud sync is enabled and the first sync is done) with retries.
 * Flag off, signed out, no network or a server error: the journal behaves exactly as before; nothing local is lost.
 *
 * Isolation: one engine per user, reading only that user's space; on account switch / sign-out the old engine gets
 * up to 3 s to send and is stopped. Its queue stays on the device for the next session of that account.
 */
export class CloudJournalRepository implements JournalRepository {
  private flagCache = new Map<string, { enabled: boolean; at: number }>();
  private listeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private inflight = new Set<Promise<unknown>>();
  private engines = new Map<string, JournalSyncEngine>();
  private pullState: { state?: JournalCloudState; error?: string } = {};
  private batchVersions: Map<string, string> | null = null;
  private unsubscribeBatches: (() => void) | null = null;
  private unregisterFlush: (() => void) | null = null;
  private unsubscribeSpace: (() => void) | null = null;
  private readonly tabId: string;

  constructor(
    private readonly local: LocalStorageJournalRepository,
    private readonly remote: JournalCloudRemote | null,
    private readonly now: () => Date = () => new Date(),
    tabId?: string
  ) {
    this.tabId = tabId ?? `tab_${Math.random().toString(36).slice(2, 10)}_${++tabCounter}`;
    if (typeof window !== "undefined" && remote) {
      // Sign-out / account switch: give the old account's queue a short chance, then stop its engine
      this.unregisterFlush = AppStorage.registerFlushHandler(async (spaceId) => {
        const userId = spaceId.startsWith("account:") ? spaceId.slice("account:".length) : null;
        const engine = userId ? this.engines.get(userId) : undefined;
        if (!engine) return;
        await engine.flushWithin(SYNC_FLUSH_ON_SIGN_OUT_MS);
        engine.stop();
        this.engines.delete(userId!);
      });
    }
  }

  /** Stops every engine and handler (tests; the app keeps one repository for the page lifetime). */
  dispose(): void {
    this.engines.forEach((e) => e.stop());
    this.engines.clear();
    this.unregisterFlush?.();
    this.unsubscribeBatches?.();
    this.unsubscribeSpace?.();
    this.unregisterFlush = this.unsubscribeBatches = this.unsubscribeSpace = null;
  }

  // ---- cloud plumbing ----

  getCloudStatus(): JournalCloudStatus {
    const userId = AppStorage.getUserId();
    const cached = userId ? this.flagCache.get(userId) : undefined;
    if (!userId || !this.remote || !cached?.enabled) return { state: "local", pending: 0, blocked: [] };
    const s = this.engines.get(userId)?.status();
    const engineState = s ? ENGINE_TO_CLOUD_STATE[s.state] : undefined;
    const pullFailed = this.pullState.state === "error" || this.pullState.state === "offline";
    return {
      state: (pullFailed ? this.pullState.state : engineState ?? this.pullState.state) ?? "synced",
      pending: s?.pending ?? 0,
      blocked: (s?.blocked ?? []).map(({ table, id, blocked }) => ({ table, id, blocked })),
      lastError: s?.lastError ?? this.pullState.error,
    };
  }

  /** Status changes (for the sync badge in 4e). */
  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyStatus = () => this.statusListeners.forEach((l) => l());

  /** Resolves when every background request started so far has finished (tests). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const engines = [...this.engines.values()];
      await Promise.allSettled([...this.inflight, ...engines.map((e) => e.idle())]);
      if (!this.inflight.size && engines.every((e) => !e.isRunning())) return;
    }
  }

  /** Sends everything queued for the current account now ("Retry now"). Never throws. */
  syncNow(): Promise<void> {
    const userId = this.mayUseCloud();
    return userId ? this.track(this.engineFor(userId).flush(true)) : Promise.resolve();
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p)).catch(() => {});
    return p;
  }

  /** Cheap synchronous check: is it worth looking at changes for the cloud at all? */
  private mayUseCloud(): string | null {
    if (!this.remote) return null;
    const userId = AppStorage.getUserId();
    if (!userId) return null;
    const cached = this.flagCache.get(userId);
    if (cached && !cached.enabled && this.now().getTime() - cached.at < JOURNAL_CLOUD_FLAG_TTL_MS) return null;
    return userId;
  }

  /** "on" only when the server says sync is on for this user and the session belongs to the same user. */
  private cloudReady = async (userId: string): Promise<CloudReadiness> => {
    if (!this.remote) return "off";
    try {
      if ((await this.remote.currentUserId()) !== userId) return "otherSession";
      const cached = this.flagCache.get(userId);
      if (cached && this.now().getTime() - cached.at < JOURNAL_CLOUD_FLAG_TTL_MS) return cached.enabled ? "on" : "off";
      const enabled = await this.remote.isSyncEnabled(userId);
      this.flagCache.set(userId, { enabled, at: this.now().getTime() });
      this.notifyStatus();
      return enabled ? "on" : "off";
    } catch {
      // Not reachable: ask again next time (the answer is not cached)
      return "unreachable";
    }
  };

  /** Engine of this user; engines of other users are stopped (their queues stay on the device). */
  private engineFor(userId: string): JournalSyncEngine {
    for (const [id, e] of this.engines) {
      if (id !== userId || e.isStopped()) {
        e.stop();
        this.engines.delete(id);
      }
    }
    let engine = this.engines.get(userId);
    if (!engine) {
      engine = new JournalSyncEngine(userId, {
        remote: this.remote!,
        // Always the engine's own account, never "the current space"
        readEntries: (uid) => snapshotEntries(new LocalStorageJournalRepository(undefined, uid).getAllRecords(), listImportBatches(uid)),
        cloudReady: this.cloudReady,
        onFlagOff: (uid) => this.flagCache.set(uid, { enabled: false, at: this.now().getTime() }),
        tabId: this.tabId,
        now: () => this.now().getTime(),
        onChange: this.notifyStatus,
      });
      this.engines.set(userId, engine);
      engine.start();
    }
    return engine;
  }

  private batchEntries(): CloudEntry[] {
    return importBatchEntries(listImportBatches());
  }

  private allEntries(): CloudEntry[] {
    return snapshotEntries(this.local.getAllRecords(), listImportBatches());
  }

  /** Runs a local write; the records it changed go into the account's outbox. */
  private write<T>(fn: () => T): T {
    const userId = this.mayUseCloud();
    if (!userId) return fn();
    const before = versionMap(this.allEntries());
    const result = fn();
    const changed = changedEntries(before, this.allEntries());
    if (changed.length && AppStorage.getUserId() === userId) this.engineFor(userId).enqueue(changed);
    return result;
  }

  private readCursor(userId: string): Partial<Record<JournalCloudTable, string>> {
    try {
      const raw = AppStorage.getItem(CURSOR_KEY, userId);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Takes records changed in the cloud since the last pull (last-write-wins: only strictly newer ones replace local
   * records). Never throws. Does nothing when the cloud is not used for this account, or before the first sync
   * (plan 3.1: cloud changes are applied only after the first upload/download).
   */
  pullFromCloud(): Promise<PullResult> {
    return this.track(this.doPull());
  }

  private async doPull(): Promise<PullResult> {
    const userId = this.mayUseCloud();
    if (!userId) return { ok: false, applied: 0 };
    const ready = await this.cloudReady(userId);
    if (ready !== "on") {
      if (ready === "unreachable") this.pullState = { state: "offline" };
      return { ok: false, applied: 0 };
    }
    if (AppStorage.getUserId() !== userId) return { ok: false, applied: 0 };
    void this.engineFor(userId).flush(); // what waited in the queue (e.g. from the last session) goes out
    if (!isInitialSyncDone(userId)) return { ok: false, applied: 0 };
    try {
      const cursor = this.readCursor(userId);
      const nextCursor = { ...cursor };
      const remote: CloudEntry[] = [];
      for (const table of JOURNAL_CLOUD_TABLES) {
        const since = cursor[table] ? new Date(Date.parse(cursor[table]!) - JOURNAL_CLOUD_PULL_OVERLAP_MS).toISOString() : null;
        for (const row of await this.remote!.fetchSince(table, since)) {
          const res = decodeRow(table, row);
          if (res.ok) remote.push(res.entry);
          if (!nextCursor[table] || row.updated_at > nextCursor[table]!) nextCursor[table] = row.updated_at;
        }
      }
      // The user may have switched account while we were waiting: never write into another space
      if (AppStorage.getUserId() !== userId) return { ok: false, applied: 0 };
      const merged = mergeEntries(this.local.getAllRecords(), listImportBatches(), remote);
      if (merged.applied) {
        this.local.replaceAllRecords(merged.snapshot);
        replaceImportBatches(merged.batches);
        this.batchVersions = versionMap(this.batchEntries());
      }
      AppStorage.setItem(CURSOR_KEY, JSON.stringify(nextCursor), userId);
      this.pullState = { state: "synced" };
      if (merged.applied) this.listeners.forEach((l) => l());
      return { ok: true, applied: merged.applied };
    } catch (e) {
      this.pullState = { state: "error", error: e instanceof Error ? e.message : String(e) };
      return { ok: false, applied: 0 };
    }
  }

  /** The import history lives outside the repository; mirror its changes as well. */
  private onImportBatchesChanged = () => {
    const userId = this.mayUseCloud();
    const batches = this.batchEntries();
    const before = this.batchVersions;
    this.batchVersions = versionMap(batches);
    if (!userId) return;
    const changed = before ? changedEntries(before, batches) : batches;
    if (changed.length) this.engineFor(userId).enqueue(changed);
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.unsubscribeBatches) {
      this.batchVersions = versionMap(this.batchEntries());
      this.unsubscribeBatches = subscribeImportBatches(this.onImportBatchesChanged);
      // An account became active (sign-in, reload, other tab): start its engine — the queue of the last session goes out
      this.unsubscribeSpace = spaceTabChannel.subscribe(() => void this.pullFromCloud());
    }
    void this.pullFromCloud();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.unsubscribeBatches) {
        this.unsubscribeBatches();
        this.unsubscribeSpace?.();
        this.unsubscribeBatches = this.unsubscribeSpace = null;
      }
    };
  }

  // ---- JournalRepository: reads are local ----

  getAllRecords(): JournalSnapshot {
    return this.local.getAllRecords();
  }
  getPrimaryPropAccountId() {
    return this.local.getPrimaryPropAccountId();
  }
  getAccounts(): Account[] {
    return this.local.getAccounts();
  }
  getAccount(id: string): Account | null {
    return this.local.getAccount(id);
  }
  getTrades(): Trade[] {
    return this.local.getTrades();
  }
  getTrade(id: string): Trade | null {
    return this.local.getTrade(id);
  }
  getStrategies(): Strategy[] {
    return this.local.getStrategies();
  }
  getStrategy(id: string): Strategy | null {
    return this.local.getStrategy(id);
  }
  getNoTrades(): NoTradeEntry[] {
    return this.local.getNoTrades();
  }
  getNoTrade(id: string): NoTradeEntry | null {
    return this.local.getNoTrade(id);
  }
  getTradingPlan(date: string): TradingPlan | null {
    return this.local.getTradingPlan(date);
  }
  getTradingPlans(): TradingPlan[] {
    return this.local.getTradingPlans();
  }
  getWeekPlan(weekStartDate: string): WeekPlan | null {
    return this.local.getWeekPlan(weekStartDate);
  }
  getWeekPlans(): WeekPlan[] {
    return this.local.getWeekPlans();
  }
  getNotes(): Note[] {
    return this.local.getNotes();
  }
  getNote(id: string): Note | null {
    return this.local.getNote(id);
  }
  getStorageUsage(): StorageUsage {
    return this.local.getStorageUsage();
  }

  // ---- JournalRepository: writes are local first, then queued ----

  setPrimaryPropAccountId(id: string | null | undefined): void {
    this.write(() => this.local.setPrimaryPropAccountId(id));
  }
  saveAccount(account: Account): Account {
    return this.write(() => this.local.saveAccount(account));
  }
  archiveAccount(id: string): Account {
    return this.write(() => this.local.archiveAccount(id));
  }
  deleteAccount(id: string): boolean {
    return this.write(() => this.local.deleteAccount(id));
  }
  saveTrade(trade: Trade): Trade {
    return this.write(() => this.local.saveTrade(trade));
  }
  deleteTrade(id: string): boolean {
    return this.write(() => this.local.deleteTrade(id));
  }
  importTrades(trades: Trade[]): number {
    return this.write(() => this.local.importTrades(trades));
  }
  deleteTradesByBatch(batchId: string): number {
    return this.write(() => this.local.deleteTradesByBatch(batchId));
  }
  saveStrategy(strategy: Strategy): Strategy {
    return this.write(() => this.local.saveStrategy(strategy));
  }
  archiveStrategy(id: string): Strategy {
    return this.write(() => this.local.archiveStrategy(id));
  }
  deleteStrategy(id: string): boolean {
    return this.write(() => this.local.deleteStrategy(id));
  }
  saveNoTrade(entry: NoTradeEntry): NoTradeEntry {
    return this.write(() => this.local.saveNoTrade(entry));
  }
  deleteNoTrade(id: string): boolean {
    return this.write(() => this.local.deleteNoTrade(id));
  }
  saveTradingPlan(plan: TradingPlan): TradingPlan {
    return this.write(() => this.local.saveTradingPlan(plan));
  }
  deleteTradingPlan(date: string): boolean {
    return this.write(() => this.local.deleteTradingPlan(date));
  }
  saveWeekPlan(plan: WeekPlan): WeekPlan {
    return this.write(() => this.local.saveWeekPlan(plan));
  }
  deleteWeekPlan(weekStartDate: string): boolean {
    return this.write(() => this.local.deleteWeekPlan(weekStartDate));
  }
  saveNote(note: Note): Note {
    return this.write(() => this.local.saveNote(note));
  }
  archiveNote(id: string): Note {
    return this.write(() => this.local.archiveNote(id));
  }
  deleteNote(id: string): boolean {
    return this.write(() => this.local.deleteNote(id));
  }
}
