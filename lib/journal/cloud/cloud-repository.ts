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
import { JOURNAL_CLOUD_FLAG_TTL_MS, SYNC_FLUSH_ON_SIGN_OUT_MS } from "./config";
import type { JournalCloudRemote } from "./remote";
import { changedEntries, importBatchEntries, snapshotEntries, versionMap, type CloudEntry, type JournalCloudTable } from "./records";
import { JournalSyncEngine, type CloudReadiness, type ConflictChoice, type LocalJournal, type SyncEngineState } from "./sync-engine";
import type { StoredConflict } from "./sync-merge";
import type { OutboxEntry } from "./outbox";

/**
 * - local: cloud not used (guest, flag off, not configured)
 * - waitingInitialSync: flag on, first upload not done yet — nothing is exchanged (4d adds the button)
 * - syncing / synced / offline / error: state of the last exchange
 */
export type JournalCloudState = "local" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error";

export interface JournalCloudStatus {
  state: JournalCloudState;
  /** Changes waiting in the queue of the current account. */
  pending: number;
  /** Records the server would reject (too large / time from the future): kept locally, not retried until changed. */
  blocked: Pick<OutboxEntry, "table" | "id" | "blocked">[];
  /** Records changed both here and in the cloud, waiting for the user's choice (dialog in 4c). */
  conflicts: number;
  lastError?: string;
}

export interface PullResult {
  /** false when the cloud was not used or the exchange failed. */
  ok: boolean;
  /** Cloud records taken into the local journal. */
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
 * Cloud journal behind the same JournalRepository interface (T7b-3; queue in T7b-4a; pull and conflicts in T7b-4b).
 *
 * The local repository stays the working copy: every read is local and synchronous, every write goes to the local
 * journal first. Changed records of an account go into that account's outbox on this device; a sync engine per account
 * first pulls cloud changes (merged by base version, conflicts kept aside) and then sends the queue.
 * Flag off, signed out, no network or a server error: the journal behaves exactly as before; nothing local is lost.
 *
 * Isolation: one engine per user, reading and writing only that user's space; on account switch / sign-out the old
 * engine gets up to 3 s to send and is stopped. Its queue stays on the device for the next session of that account.
 */
export class CloudJournalRepository implements JournalRepository {
  private flagCache = new Map<string, { enabled: boolean; at: number }>();
  private listeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private inflight = new Set<Promise<unknown>>();
  private engines = new Map<string, JournalSyncEngine>();
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
    if (!userId || !this.remote || !cached?.enabled) return { state: "local", pending: 0, blocked: [], conflicts: 0 };
    const s = this.engines.get(userId)?.status();
    return {
      state: s ? ENGINE_TO_CLOUD_STATE[s.state] : "synced",
      pending: s?.pending ?? 0,
      blocked: (s?.blocked ?? []).map(({ table, id, blocked }) => ({ table, id, blocked })),
      conflicts: s?.conflicts ?? 0,
      lastError: s?.lastError,
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
  private notifyData = () => this.listeners.forEach((l) => l());

  /** Resolves when every background request started so far has finished (tests). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const engines = [...this.engines.values()];
      await Promise.allSettled([...this.inflight, ...engines.map((e) => e.idle())]);
      if (!this.inflight.size && engines.every((e) => !e.isRunning())) return;
    }
  }

  /** Pulls and sends everything queued for the current account now ("Retry now"). Never throws. */
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

  /** Journal of an explicit account (never "the current space"). */
  private readJournal = (uid: string): LocalJournal => ({
    snapshot: new LocalStorageJournalRepository(undefined, uid).getAllRecords(),
    batches: listImportBatches(uid),
  });

  private writeJournal = (uid: string, journal: LocalJournal): void => {
    new LocalStorageJournalRepository(undefined, uid).replaceAllRecords(journal.snapshot);
    replaceImportBatches(journal.batches, uid);
    if (uid === AppStorage.getUserId()) this.batchVersions = versionMap(this.batchEntries());
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
        readJournal: this.readJournal,
        writeJournal: this.writeJournal,
        cloudReady: this.cloudReady,
        onFlagOff: (uid) => this.flagCache.set(uid, { enabled: false, at: this.now().getTime() }),
        onRemoteApplied: this.notifyData,
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

  /**
   * Exchanges with the cloud now: pulls changes made elsewhere (merged by base version) and sends the queue.
   * Never throws. Does nothing when the cloud is not used for this account or before the first sync.
   */
  pullFromCloud(): Promise<PullResult> {
    const userId = this.mayUseCloud();
    if (!userId) return Promise.resolve({ ok: false, applied: 0 });
    const engine = this.engineFor(userId);
    return this.track(
      engine.flush().then(() => {
        const r = engine.lastRunResult();
        return { ok: r.pulled, applied: r.applied };
      })
    );
  }

  /** The cloud is used for the signed-in account right now (flag known to be on). Guests and flag off: false. */
  isCloudActive(): boolean {
    const userId = AppStorage.getUserId();
    return Boolean(userId && this.remote && this.flagCache.get(userId)?.enabled);
  }

  /** Records changed both here and in the cloud (for the dialog in 4c). Empty unless the cloud is active. */
  listConflicts(): StoredConflict[] {
    const userId = this.mayUseCloud();
    if (!userId || !this.isCloudActive()) return [];
    return this.engineFor(userId).listConflicts();
  }

  /** "Keep this device" or "Take from cloud" for one conflicting record. */
  resolveConflict(table: JournalCloudTable | string, id: string, choice: ConflictChoice): boolean {
    const userId = this.mayUseCloud();
    if (!userId) return false;
    const engine = this.engineFor(userId);
    const done = engine.resolveConflict(table as JournalCloudTable, id, choice);
    if (done) void this.track(engine.flush(true));
    return done;
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
