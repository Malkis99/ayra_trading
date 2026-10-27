import type {
  Account,
  AttachmentCloudState,
  JournalAttachment,
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
import type { JournalPreferences } from "../types";
import { listImportBatches, replaceImportBatches, subscribeImportBatches } from "../import/batches";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { JOURNAL_CLOUD_FLAG_TTL_MS, SYNC_FLUSH_ON_SIGN_OUT_MS } from "./config";
import type { JournalCloudRemote } from "./remote";
import { changedEntries, entryKey, entryVersion, importBatchEntries, snapshotEntries, versionMap, type CloudEntry, type JournalCloudTable } from "./records";
import { readBase } from "./sync-merge";
import { outboxKey } from "./outbox";
import {
  JournalSyncEngine,
  hasLiveData,
  type CloudReadiness,
  type ConflictChoice,
  type InitialSyncPlan,
  type InitialSyncResult,
  type LocalJournal,
  type SyncEngineState,
} from "./sync-engine";
import { isInitialSyncDone, readSyncState } from "./sync-state";
import { readSyncMode, writeSyncMode, type SyncMode } from "./sync-mode";
import type { StoredConflict } from "./sync-merge";
import type { OutboxEntry } from "./outbox";
import type { AttachmentMetadata } from "../attachments/types";
import {
  ATTACHMENTS_TABLE,
  AttachmentFiles,
  readUploadsPaused,
  writeUploadsPaused,
  type AttachmentFileRemote,
  type AttachmentFilesDeps,
} from "./attachment-files";

/** Screenshots of the account and the cloud, for Settings → Cloud and data (0005-C). */
export interface ScreenshotsCloudStatus {
  /** Screenshots of live trades described by the journal. */
  total: number;
  /** Of them, with the file in the cloud. */
  inCloud: number;
  /** Waiting to go up (queued). */
  waiting: number;
  /** «Stop» was pressed. */
  paused: boolean;
  /** The upload is running by itself («Automatic», not stopped, something to send). */
  uploading: boolean;
  /** Tried several times and failed (not counting no space). */
  failed: number;
  /** Waiting because the cloud has no space. */
  noSpace: number;
}

/**
 * - local: cloud not used (guest, flag off, not configured)
 * - waitingInitialSync: flag on, first upload not done yet — nothing is exchanged (4d adds the button)
 * - syncing / synced / offline / error: state of the last exchange
 */
export type JournalCloudState = "local" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error" | "manual";

export interface JournalCloudStatus {
  state: JournalCloudState;
  /** Changes waiting in the queue of the current account. */
  pending: number;
  /** Records the server would reject (too large / time from the future): kept locally, not retried until changed. */
  blocked: Pick<OutboxEntry, "table" | "id" | "blocked">[];
  /** Records changed both here and in the cloud, waiting for the user's choice (dialog in 4c). */
  conflicts: number;
  lastError?: string;
  /** Last successful exchange with the cloud (ISO). */
  lastSyncAt?: string;
  /** Screenshots waiting because the cloud has no space for them (they stay on this device). */
  noSpace?: number;
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
  manual: "manual",
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
  /** An empty device downloaded the cloud journal (records), not yet shown to the user. */
  private cloudDownloaded: number | null = null;
  /** Screenshot files in the cloud (0005). */
  readonly attachmentFiles: AttachmentFiles;

  constructor(
    private readonly local: LocalStorageJournalRepository,
    private readonly remote: JournalCloudRemote | null,
    private readonly now: () => Date = () => new Date(),
    tabId?: string,
    fileRemote: AttachmentFileRemote | null = null,
    /** Tests: the browser store of screenshots and the preview maker (the app uses IndexedDB and a canvas). */
    fileOptions: Pick<AttachmentFilesDeps, "files" | "makePreview"> = {}
  ) {
    this.tabId = tabId ?? `tab_${Math.random().toString(36).slice(2, 10)}_${++tabCounter}`;
    this.attachmentFiles = new AttachmentFiles({ remote: fileRemote, readJournal: this.readJournal, now: () => this.now().getTime(), ...fileOptions });
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
    const engine = this.engines.get(userId);
    const s = engine?.status();
    const noSpace = engine ? engine.outbox.list().filter((e) => e.table === ATTACHMENTS_TABLE && e.lastError === "noSpace").length : 0;
    return {
      noSpace,
      state: s ? ENGINE_TO_CLOUD_STATE[s.state] : "synced",
      pending: s?.pending ?? 0,
      blocked: (s?.blocked ?? []).map(({ table, id, blocked }) => ({ table, id, blocked })),
      conflicts: s?.conflicts ?? 0,
      lastError: s?.lastError,
      lastSyncAt: readSyncState(userId).lastSyncAt,
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
    return userId ? this.track(this.engineFor(userId).flush(true, true)) : Promise.resolve();
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
        onCloudDownloaded: (n) => {
          this.cloudDownloaded = n;
          this.notifyStatus();
        },
        tabId: this.tabId,
        now: () => this.now().getTime(),
        onChange: this.notifyStatus,
        isManual: () => readSyncMode(userId) === "manual",
        prepareFiles: (uid, entries, opts) => this.attachmentFiles.prepare(uid, entries, opts),
        onExchanged: (uid, { byUser }) => void this.track(this.afterExchange(uid, byUser)),
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

  /**
   * Records written into this account's journal outside the repository (the guest journal copied in, variant A):
   * every record the cloud has not seen in this version is queued, so it goes up like any other change and the
   * badge shows «waiting to be sent» until it has. Before the first sync nothing is queued: the journal waits for
   * «Upload to the cloud» as a whole (the badge says so). Returns how many records were queued.
   */
  adoptLocalRecords(): number {
    const userId = this.mayUseCloud();
    if (!userId) return 0;
    if (!isInitialSyncDone(userId)) {
      this.notifyStatus();
      return 0;
    }
    const engine = this.engineFor(userId);
    const journal = this.readJournal(userId);
    const base = readBase(userId);
    const queued = new Set(engine.outbox.list().map(outboxKey));
    const fresh = snapshotEntries(journal.snapshot, journal.batches).filter((e) => base[entryKey(e)] !== entryVersion(e) && !queued.has(entryKey(e)));
    engine.enqueue(fresh);
    this.notifyStatus();
    return fresh.length;
  }

  /** Auto / manual exchange on this device for the signed-in account (not synced). */
  getSyncMode(): SyncMode {
    const userId = AppStorage.getUserId();
    return userId ? readSyncMode(userId) : "auto";
  }

  /** Switching to auto exchanges at once (what waited goes up, changes from elsewhere come down). */
  setSyncMode(mode: SyncMode): void {
    const userId = AppStorage.getUserId();
    if (!userId) return;
    writeSyncMode(userId, mode);
    if (this.mayUseCloud() === userId) {
      const engine = this.engineFor(userId);
      if (mode === "auto") void this.track(engine.flush(true));
      else void this.track(engine.flush());
    }
    this.notifyStatus();
  }

  /** The cloud is used for the signed-in account right now (flag known to be on). Guests and flag off: false. */
  isCloudFlagKnown(): boolean {
    const userId = AppStorage.getUserId();
    return !userId || !this.remote || this.flagCache.has(userId);
  }

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
    if (done && table === "journal_trades") this.restoreTradeScreenshots(id);
    if (done) void this.track(engine.flush(true, true));
    return done;
  }

  /**
   * «Deleted against edited» for a trade, settled in favour of the edit (either side): the trade is live again, so the
   * screenshots it lists, deleted together with it, come back too. Their files are still in the cloud (removed only
   * 30 days after a deletion). A screenshot deleted on purpose is no longer listed by its trade and stays deleted.
   */
  private restoreTradeScreenshots(tradeId: string): void {
    const trade = this.local.getTrade(tradeId);
    if (!trade) return;
    const listed = new Set(trade.attachmentIds || []);
    const gone = this.local.getAttachmentRecords(true).filter((a) => a.tradeId === tradeId && a.deletedAt && listed.has(a.id));
    if (gone.length) this.write(() => gone.forEach((a) => this.local.restoreAttachmentRecord(a.id)));
    this.notifyData();
  }

  /* ---- first sync (4d) ---- */

  /**
   * needed: the cloud is active for this account and its journal on this device was never synced, with local data
   * (an empty device downloads by itself). started: a first upload was started before (offer "Continue").
   */
  getInitialSyncInfo(): { needed: boolean; started: boolean } {
    const userId = this.mayUseCloud();
    if (!userId || !this.isCloudActive() || isInitialSyncDone(userId)) return { needed: false, started: false };
    return { needed: hasLiveData(this.readJournal(userId)), started: Boolean(readSyncState(userId).initialUploadStartedAt) };
  }

  /** What the first upload will do (counts for the preview). Throws when the cloud cannot be reached. */
  analyzeInitialSync(): Promise<InitialSyncPlan> {
    const userId = this.mayUseCloud();
    if (!userId) return Promise.reject(new Error("local"));
    return this.track(this.engineFor(userId).analyzeInitial());
  }

  /** Runs the first upload (button). Throws on network errors / account switch; nothing is lost locally. */
  async runInitialSync(opts?: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }): Promise<InitialSyncResult> {
    const userId = this.mayUseCloud();
    if (!userId) throw new Error("local");
    const result = await this.track(this.engineFor(userId).runInitial(opts));
    this.notifyStatus();
    return result;
  }

  /** Records an empty device downloaded by itself, once (then forgotten): the app shows one notice. */
  takeCloudDownloadNotice(): number | null {
    const n = this.cloudDownloaded;
    this.cloudDownloaded = null;
    return n;
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
  getPreferences() {
    return this.local.getPreferences();
  }

  setPreferences(preferences: JournalPreferences): void {
    this.write(() => this.local.setPreferences(preferences));
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

  /**
   * After an exchange (0005-B/C): screenshots this browser has but the journal does not describe yet become rows and
   * go up like new ones; files from other devices come down (by themselves only in «Automatic», «Download» in
   * «Manual»); once a day the account's folder in the cloud is cleaned (in «Manual» only on «Synchronise»).
   */
  private async afterExchange(userId: string, byUser: boolean): Promise<void> {
    const manual = readSyncMode(userId) === "manual";
    await this.adoptUndescribedScreenshots(userId);
    await this.attachmentFiles.reconcile(userId, { download: !manual });
    if (!manual || byUser) await this.attachmentFiles.cleanup(userId).catch(() => 0);
  }

  /** Screenshots added before 0005 (or copied from the guest before it): rows for them, queued — no rewards. */
  private async adoptUndescribedScreenshots(userId: string): Promise<number> {
    const metas = await this.attachmentFiles.undescribed(userId);
    if (!metas.length || AppStorage.getUserId() !== userId) return 0;
    const repo = new LocalStorageJournalRepository(undefined, userId);
    const entries: CloudEntry[] = metas.map((m) => ({ table: ATTACHMENTS_TABLE, id: m.id, record: repo.saveAttachmentRecord(m) as unknown as CloudEntry["record"] }));
    this.engineFor(userId).enqueue(entries);
    this.notifyData();
    return entries.length;
  }

  /**
   * Screenshots of the account and the cloud (Settings → Cloud and data): how many are in the cloud, whether the
   * upload runs or is stopped, how many failed or wait for space.
   */
  getScreenshotsCloudStatus(): ScreenshotsCloudStatus | null {
    const userId = AppStorage.getUserId();
    if (!userId || !this.isCloudActive()) return null;
    const liveTrades = new Set(this.local.getTrades().map((t) => t.id));
    const rows = this.local.getAttachmentRecords().filter((a) => liveTrades.has(a.tradeId));
    const queued = (this.engines.get(userId)?.outbox.list() ?? []).filter((e) => e.table === ATTACHMENTS_TABLE && rows.some((a) => a.id === e.id));
    const paused = readUploadsPaused(userId);
    const failed = queued.filter((e) => e.lastError && e.lastError !== "noSpace" && e.attempts >= 3).length;
    const noSpace = queued.filter((e) => e.lastError === "noSpace").length;
    return {
      total: rows.length,
      inCloud: rows.filter((a) => this.attachmentFiles.isInCloud(userId, a.id)).length,
      waiting: queued.length,
      paused,
      uploading: !paused && queued.length > failed + noSpace && readSyncMode(userId) === "auto",
      failed,
      noSpace,
    };
  }

  /** «Stop»: what is uploaded stays; nothing more goes up until «Continue» (a file being uploaded finishes). */
  pauseScreenshotUploads(): void {
    const userId = AppStorage.getUserId();
    if (!userId) return;
    writeUploadsPaused(userId, true);
    this.notifyStatus();
  }

  /** «Continue» (and «Retry» for the ones that failed): the waiting screenshots go up now. */
  resumeScreenshotUploads(): Promise<void> {
    const userId = AppStorage.getUserId();
    if (!userId) return Promise.resolve();
    writeUploadsPaused(userId, false);
    const engine = this.engineFor(userId);
    engine.outbox.release((e) => e.table === ATTACHMENTS_TABLE, this.now().getTime());
    this.notifyStatus();
    return this.track(engine.flush(true, true));
  }

  attachmentCloudState(id: string): AttachmentCloudState {
    const userId = AppStorage.getUserId();
    if (!userId || !this.isCloudActive()) return "none";
    if (this.attachmentFiles.isDownloading(id)) return "downloading";
    const queued = this.engines.get(userId)?.outbox.list().find((e) => e.table === ATTACHMENTS_TABLE && e.id === id);
    if (queued?.lastError === "noSpace") return "noSpace";
    const row = this.local.getAttachmentRecords().find((a) => a.id === id);
    return row && this.attachmentFiles.isInCloud(userId, id) ? "inCloud" : "none";
  }

  downloadAttachment(id: string, opts: { byUser?: boolean } = {}): Promise<boolean> {
    const userId = AppStorage.getUserId();
    if (!userId || !this.isCloudActive()) return Promise.resolve(false);
    // «Manual»: a file comes down only when the person presses «Download» (owner decision 2026-10-26)
    if (!opts.byUser && readSyncMode(userId) === "manual") return Promise.resolve(false);
    return this.track(this.attachmentFiles.download(userId, id));
  }

  /**
   * The copy of a screenshot on this device cannot be shown (a broken picture, seen on iPhones before the fix): when the
   * cloud has the file, a fresh copy is downloaded and replaces it. In manual mode only by «Download». Nothing in the
   * cloud is touched; a screenshot that is only on this device is never replaced.
   */
  repairAttachment(id: string, opts: { byUser?: boolean } = {}): Promise<boolean> {
    const userId = AppStorage.getUserId();
    if (!userId || !this.isCloudActive() || !this.attachmentFiles.isInCloud(userId, id)) return Promise.resolve(false);
    if (!opts.byUser && readSyncMode(userId) === "manual") return Promise.resolve(false);
    return this.track(this.attachmentFiles.download(userId, id, { replace: true }));
  }

  subscribeAttachmentFiles(listener: () => void): () => void {
    return this.attachmentFiles.subscribe(listener);
  }

  getAttachmentRecords(withDeleted = false): JournalAttachment[] {
    return this.local.getAttachmentRecords(withDeleted);
  }
  saveAttachmentRecord(meta: AttachmentMetadata): JournalAttachment {
    return this.write(() => this.local.saveAttachmentRecord(meta));
  }
  updateAttachmentRecord(id: string, updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>): JournalAttachment | null {
    return this.write(() => this.local.updateAttachmentRecord(id, updates));
  }
  deleteAttachmentRecord(id: string): boolean {
    return this.write(() => this.local.deleteAttachmentRecord(id));
  }
  restoreAttachmentRecord(id: string): JournalAttachment | null {
    return this.write(() => this.local.restoreAttachmentRecord(id));
  }
}
