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
import type { LocalStorageJournalRepository } from "../repository";
import { listImportBatches, replaceImportBatches, subscribeImportBatches } from "../import/batches";
import { AppStorage } from "@/lib/storage";
import { JOURNAL_CLOUD_FLAG_TTL_MS, JOURNAL_CLOUD_PULL_OVERLAP_MS } from "./config";
import type { JournalCloudRemote } from "./remote";
import {
  JOURNAL_CLOUD_TABLES,
  changedEntries,
  decodeRow,
  encodeEntry,
  importBatchEntries,
  mergeEntries,
  snapshotEntries,
  versionMap,
  type CloudEntry,
  type EncodeSkipReason,
  type JournalCloudTable,
  type JournalCloudWriteRow,
} from "./records";

const CURSOR_KEY = "ayra_journal_cloud_cursor";
const DEVICE_ID_KEY = "ayra_sync_device_id";

/**
 * - local: cloud not used (guest, flag off, not configured, server not reachable)
 * - synced: last exchange with the cloud succeeded
 * - error: the last exchange failed; the local journal is intact
 */
export type JournalCloudState = "local" | "synced" | "error";

export interface JournalCloudStatus {
  state: JournalCloudState;
  /** Records the client refused to send (the server would reject them), last push. */
  skipped: { table: JournalCloudTable; id: string; reason: EncodeSkipReason }[];
  lastError?: string;
}

export interface PullResult {
  /** false when the cloud was not used (see JournalCloudState "local") or the pull failed. */
  ok: boolean;
  applied: number;
}

/**
 * Cloud journal behind the same JournalRepository interface (T7b-3).
 *
 * The local repository stays the working copy: every read is local and synchronous, every write goes to the
 * local journal first. Then — only when the account has cloud sync enabled (user_features.cloud_sync) — the changed
 * records are sent to the 9 cloud tables in the background. Flag off, signed out, no network or a server error:
 * the journal behaves exactly as before; nothing local is lost or blocked.
 *
 * Not here yet (T7b-4): an outbox with retries, the conflict dialog, the first upload of existing local data.
 */
export class CloudJournalRepository implements JournalRepository {
  private flagCache = new Map<string, { enabled: boolean; at: number }>();
  private listeners = new Set<() => void>();
  private inflight = new Set<Promise<unknown>>();
  private status: JournalCloudStatus = { state: "local", skipped: [] };
  private batchVersions: Map<string, string> | null = null;
  private unsubscribeBatches: (() => void) | null = null;

  constructor(
    private readonly local: LocalStorageJournalRepository,
    private readonly remote: JournalCloudRemote | null,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ---- cloud plumbing ----

  getCloudStatus(): JournalCloudStatus {
    return { ...this.status, skipped: [...this.status.skipped] };
  }

  /** Resolves when every background request started so far has finished (tests, flush before sign-out). */
  async whenIdle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p)).catch(() => {});
    return p;
  }

  private fail(e: unknown): void {
    this.status = { ...this.status, state: "error", lastError: e instanceof Error ? e.message : String(e) };
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

  /** True only when the server says sync is on for this user and the session belongs to the same user. */
  private async cloudReady(userId: string): Promise<boolean> {
    if (!this.remote) return false;
    try {
      if ((await this.remote.currentUserId()) !== userId) return false;
      const cached = this.flagCache.get(userId);
      if (cached && this.now().getTime() - cached.at < JOURNAL_CLOUD_FLAG_TTL_MS) return cached.enabled;
      const enabled = await this.remote.isSyncEnabled(userId);
      this.flagCache.set(userId, { enabled, at: this.now().getTime() });
      if (!enabled) this.status = { ...this.status, state: "local" };
      return enabled;
    } catch (e) {
      // Not reachable: behave as if sync were off, ask again next time (the answer is not cached)
      this.fail(e);
      return false;
    }
  }

  private deviceId(userId: string): string {
    let id = AppStorage.getItem(DEVICE_ID_KEY, userId);
    if (!id) {
      id = `dev_${this.now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      AppStorage.setItem(DEVICE_ID_KEY, id, userId);
    }
    return id;
  }

  private batchEntries(): CloudEntry[] {
    return importBatchEntries(listImportBatches());
  }

  private allEntries(): CloudEntry[] {
    return snapshotEntries(this.local.getAllRecords(), listImportBatches());
  }

  /** Runs a local write; the records it changed are then sent to the cloud in the background. */
  private write<T>(fn: () => T): T {
    const userId = this.mayUseCloud();
    if (!userId) return fn();
    const before = versionMap(this.allEntries());
    const result = fn();
    const changed = changedEntries(before, this.allEntries());
    if (changed.length) void this.track(this.push(userId, changed));
    return result;
  }

  private async push(userId: string, entries: CloudEntry[]): Promise<void> {
    try {
      if (!(await this.cloudReady(userId))) return;
      const deviceId = this.deviceId(userId);
      const byTable = new Map<JournalCloudTable, JournalCloudWriteRow[]>();
      const skipped: JournalCloudStatus["skipped"] = [];
      for (const e of entries) {
        const res = encodeEntry(e, deviceId, this.now());
        if (!res.ok) {
          skipped.push({ table: e.table, id: e.id, reason: res.reason });
          continue;
        }
        byTable.set(e.table, [...(byTable.get(e.table) || []), res.row]);
      }
      if (skipped.length) console.warn("[AYRA] Journal records not sent to the cloud:", skipped);
      for (const [table, rows] of byTable) await this.remote!.upsert(table, rows);
      this.status = { state: "synced", skipped };
    } catch (e) {
      this.fail(e);
    }
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
   * records). Never throws. Does nothing when the cloud is not used for this account.
   */
  pullFromCloud(): Promise<PullResult> {
    return this.track(this.doPull());
  }

  private async doPull(): Promise<PullResult> {
    const userId = this.mayUseCloud();
    if (!userId || !(await this.cloudReady(userId))) return { ok: false, applied: 0 };
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
      this.status = { ...this.status, state: "synced" };
      if (merged.applied) this.listeners.forEach((l) => l());
      return { ok: true, applied: merged.applied };
    } catch (e) {
      this.fail(e);
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
    if (changed.length) void this.track(this.push(userId, changed));
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.unsubscribeBatches) {
      this.batchVersions = versionMap(this.batchEntries());
      this.unsubscribeBatches = subscribeImportBatches(this.onImportBatchesChanged);
    }
    void this.pullFromCloud();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.unsubscribeBatches) {
        this.unsubscribeBatches();
        this.unsubscribeBatches = null;
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

  // ---- JournalRepository: writes are local first, then mirrored ----

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
