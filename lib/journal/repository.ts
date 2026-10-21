import {
  Account,
  Trade,
  Strategy,
  NoTradeEntry,
  TradingPlan,
  WeekPlan,
  Note,
  StorageUsage,
  JournalRepository,
  JournalSnapshot,
  SyncMeta,
} from "./types";
import { IndexedDBAttachmentRepository } from "./attachments/indexeddb-repository";
import { AppStorage } from "@/lib/storage";
import { sanitizePreferences } from "./preferences";
import type { JournalPreferences } from "./types";

const JOURNAL_STORAGE_KEY = "ayra_journal_v1";
/**
 * v5: primaryPropAccountId stored explicitly.
 * v6 (T7b-1): every record has updatedAt and deletedAt (soft delete / tombstone); settingsUpdatedAt.
 */
export const CURRENT_JOURNAL_SCHEMA_VERSION = 6;

export type JournalStorageData = JournalSnapshot;

function emptyJournal(): JournalStorageData {
  return {
    schemaVersion: CURRENT_JOURNAL_SCHEMA_VERSION,
    primaryPropAccountId: undefined,
    accounts: [],
    trades: [],
    strategies: [],
    noTrades: [],
    plans: [],
    weekPlans: [],
    notes: [],
  };
}

/** Kept for compatibility (a fresh empty journal); do not mutate. */
export const INITIAL_JOURNAL_DATA: JournalStorageData = emptyJournal();

let lastStamp = 0;

/** Tests only: forget the last issued time, so a test can simulate a device whose clock is behind. */
export function resetStampClockForTests(): void {
  lastStamp = 0;
}

const isLive =<T extends SyncMeta>(r: T): boolean => !r.deletedAt;
const live = <T extends SyncMeta>(list: T[]): T[] => list.filter(isLive);

/** Adds sync metadata to a record from an older version: updatedAt falls back to createdAt; nothing is lost. */
function withMeta<T extends SyncMeta & { createdAt?: string }>(r: T, fallbackTime: string): T {
  return {
    ...r,
    updatedAt: typeof r.updatedAt === "string" && r.updatedAt ? r.updatedAt : typeof r.createdAt === "string" && r.createdAt ? r.createdAt : fallbackTime,
    deletedAt: typeof r.deletedAt === "string" && r.deletedAt ? r.deletedAt : null,
  };
}

/** Migrates any stored journal (v1…v6) to the current format. Pure: exported for tests. */
export function migrateJournalData(raw: Record<string, unknown>, now: Date = new Date()): JournalStorageData {
  const nowIso = now.toISOString();
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  let rawAccounts = arr<Account>(raw.accounts);
  const rawTrades = arr<Trade>(raw.trades);

  // v5: primaryPropAccountId — if not stored explicitly, use the legacy isPrimaryProp flag
  let primaryPropAccountId = raw.primaryPropAccountId as string | null | undefined;
  rawAccounts = rawAccounts.map((acc) => ({
    ...acc,
    propRules: acc.type === "prop" ? acc.propRules || null : null,
  }));
  if (primaryPropAccountId === undefined) {
    const legacyPrimary = rawAccounts.find((a) => a.isPrimaryProp && a.type === "prop" && !a.archivedAt && !a.deletedAt);
    if (legacyPrimary) primaryPropAccountId = legacyPrimary.id;
  }

  const trades: Trade[] = rawTrades.map((t) =>
    withMeta(
      {
        ...t,
        strategyId: t.strategyId ?? null,
        strategyVersion: t.strategyVersion ?? null,
        ruleChecks: t.ruleChecks ?? {},
        processScore: typeof t.processScore === "number" ? t.processScore : null,
        processScoreSnapshot: t.processScoreSnapshot ?? null,
        attachmentIds: Array.isArray(t.attachmentIds) ? t.attachmentIds : [],
        schemaVersion: CURRENT_JOURNAL_SCHEMA_VERSION,
      },
      nowIso
    )
  );

  return {
    schemaVersion: CURRENT_JOURNAL_SCHEMA_VERSION,
    primaryPropAccountId,
    settingsUpdatedAt: typeof raw.settingsUpdatedAt === "string" ? raw.settingsUpdatedAt : undefined,
    preferences: sanitizePreferences(raw.preferences),
    accounts: rawAccounts.map((a) => withMeta(a, nowIso)),
    trades,
    strategies: arr<Strategy>(raw.strategies).map((s) => withMeta(s, nowIso)),
    noTrades: arr<NoTradeEntry>(raw.noTrades).map((e) => withMeta(e, nowIso)),
    plans: arr<TradingPlan>(raw.plans).map((p) => withMeta(p, nowIso)),
    weekPlans: arr<WeekPlan>(raw.weekPlans).map((p) => withMeta(p, nowIso)),
    notes: arr<Note>(raw.notes).map((n) => withMeta(n, nowIso)),
  };
}

/**
 * Journal in AppStorage (the current space). Reads return live records only; deletes are soft (tombstones with
 * deletedAt) so a future sync can tell "deleted" from "never existed". Every write stamps updatedAt.
 */
export class LocalStorageJournalRepository implements JournalRepository {
  private key: string;
  private userId?: string | null;

  constructor(key = JOURNAL_STORAGE_KEY, userId?: string | null) {
    this.key = key;
    this.userId = userId;
  }

  private loadData(): JournalStorageData {
    if (typeof window === "undefined") return emptyJournal();
    try {
      const raw = AppStorage.getItem(this.key, this.userId);
      if (!raw) return emptyJournal();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyJournal();
      return migrateJournalData(parsed);
    } catch (e) {
      console.error("Failed to load journal data from storage, falling back to initial", e);
      return emptyJournal();
    }
  }

  private saveData(data: JournalStorageData): void {
    if (typeof window === "undefined") return;
    try {
      AppStorage.setItem(this.key, JSON.stringify(data), this.userId);
    } catch (e) {
      console.error("Failed to save journal data to storage", e);
    }
  }

  /** Strictly increasing within this tab: two changes in the same millisecond still get different updatedAt (sync). */
  private now(): string {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp).toISOString();
  }

  /**
   * Time of a new version of a record: now, but always later than its previous version (T7b-4b). A device whose clock
   * is behind still produces a version newer than the one it got from the cloud, so its edit is not lost.
   */
  private stampAfter(previous?: string | null): string {
    const prev = previous ? Date.parse(previous) : NaN;
    const now = Date.parse(this.now());
    return new Date(Number.isNaN(prev) ? now : Math.max(now, prev + 1)).toISOString();
  }

  /** Inserts or replaces by key (a tombstone with the same key is brought back to life). */
  private upsert<T extends SyncMeta>(list: T[], item: T, same: (a: T) => boolean): T {
    const index = list.findIndex(same);
    const stamped = { ...item, updatedAt: this.stampAfter(index >= 0 ? list[index].updatedAt : undefined), deletedAt: null };
    if (index >= 0) list[index] = stamped;
    else list.push(stamped);
    return stamped;
  }

  /** Marks the live record as deleted. Returns false when there was nothing live to delete. */
  private softDelete<T extends SyncMeta>(list: T[], same: (a: T) => boolean): boolean {
    const item = list.find((r) => same(r) && isLive(r));
    if (!item) return false;
    const at = this.stampAfter(item.updatedAt);
    item.deletedAt = at;
    item.updatedAt = at;
    return true;
  }

  getAllRecords(): JournalSnapshot {
    return this.loadData();
  }

  /** Stores a whole snapshot as is (records merged from the cloud keep their own updatedAt). Not for the UI. */
  replaceAllRecords(snapshot: JournalSnapshot): void {
    this.saveData(migrateJournalData(snapshot as unknown as Record<string, unknown>));
  }

  getPrimaryPropAccountId(): string | null | undefined {
    return this.loadData().primaryPropAccountId;
  }

  setPrimaryPropAccountId(id: string | null | undefined): void {
    const data = this.loadData();
    data.primaryPropAccountId = id;
    data.settingsUpdatedAt = this.stampAfter(data.settingsUpdatedAt);
    this.saveData(data);
  }

  getPreferences(): JournalPreferences {
    return this.loadData().preferences ?? {};
  }

  setPreferences(preferences: JournalPreferences): void {
    const data = this.loadData();
    data.preferences = sanitizePreferences(preferences);
    data.settingsUpdatedAt = this.stampAfter(data.settingsUpdatedAt);
    this.saveData(data);
  }

  getAccounts(): Account[] {
    return live(this.loadData().accounts);
  }

  getAccount(id: string): Account | null {
    return this.getAccounts().find((a) => a.id === id) || null;
  }

  saveAccount(account: Account): Account {
    const data = this.loadData();
    const saved = this.upsert(data.accounts, account, (a) => a.id === account.id);
    this.saveData(data);
    return saved;
  }

  archiveAccount(id: string): Account {
    const data = this.loadData();
    const account = data.accounts.find((a) => a.id === id && isLive(a));
    if (!account) throw new Error(`Account not found: ${id}`);
    account.archivedAt = this.now();
    account.updatedAt = this.stampAfter(account.updatedAt);
    this.saveData(data);
    return account;
  }

  deleteAccount(id: string): boolean {
    const data = this.loadData();
    // Cannot delete if there are (live) trades
    if (data.trades.some((t) => t.accountId === id && isLive(t))) {
      throw new Error("Cannot delete account with trades. Archive it instead.");
    }
    if (!this.softDelete(data.accounts, (a) => a.id === id)) return false;
    this.saveData(data);
    return true;
  }

  getTradingPlans(): TradingPlan[] {
    return live(this.loadData().plans || []);
  }

  getTradingPlan(date: string): TradingPlan | null {
    return this.getTradingPlans().find((p) => p.date === date) || null;
  }

  saveTradingPlan(plan: TradingPlan): TradingPlan {
    const data = this.loadData();
    const saved = this.upsert(data.plans, plan, (p) => p.date === plan.date);
    this.saveData(data);
    return saved;
  }

  deleteTradingPlan(date: string): boolean {
    const data = this.loadData();
    if (!this.softDelete(data.plans, (p) => p.date === date)) return false;
    this.saveData(data);
    return true;
  }

  getWeekPlans(): WeekPlan[] {
    return live(this.loadData().weekPlans || []);
  }

  getWeekPlan(weekStartDate: string): WeekPlan | null {
    return this.getWeekPlans().find((p) => p.weekStartDate === weekStartDate) || null;
  }

  saveWeekPlan(plan: WeekPlan): WeekPlan {
    const data = this.loadData();
    const saved = this.upsert(data.weekPlans, plan, (p) => p.weekStartDate === plan.weekStartDate);
    this.saveData(data);
    return saved;
  }

  deleteWeekPlan(weekStartDate: string): boolean {
    const data = this.loadData();
    if (!this.softDelete(data.weekPlans, (p) => p.weekStartDate === weekStartDate)) return false;
    this.saveData(data);
    return true;
  }

  getNotes(): Note[] {
    return live(this.loadData().notes || []);
  }

  getNote(id: string): Note | null {
    return this.getNotes().find((n) => n.id === id) || null;
  }

  saveNote(note: Note): Note {
    const data = this.loadData();
    const saved = this.upsert(data.notes, note, (n) => n.id === note.id);
    this.saveData(data);
    return saved;
  }

  archiveNote(id: string): Note {
    const data = this.loadData();
    const note = data.notes.find((n) => n.id === id && isLive(n));
    if (!note) throw new Error(`Note not found: ${id}`);
    note.archivedAt = this.now();
    note.updatedAt = this.stampAfter(note.updatedAt);
    this.saveData(data);
    return note;
  }

  deleteNote(id: string): boolean {
    const data = this.loadData();
    if (!this.softDelete(data.notes, (n) => n.id === id)) return false;
    this.saveData(data);
    return true;
  }

  getTrades(): Trade[] {
    return live(this.loadData().trades);
  }

  getTrade(id: string): Trade | null {
    return this.getTrades().find((t) => t.id === id) || null;
  }

  saveTrade(trade: Trade): Trade {
    const data = this.loadData();
    const saved = this.upsert(data.trades, trade, (t) => t.id === trade.id);
    this.saveData(data);
    return saved;
  }

  deleteTrade(id: string): boolean {
    const data = this.loadData();
    if (!this.softDelete(data.trades, (t) => t.id === id)) return false;
    this.saveData(data);
    // Screenshot files of a deleted trade are not needed any more; the trade itself stays as a tombstone
    if (typeof window !== "undefined") {
      const attRepo = new IndexedDBAttachmentRepository(this.userId);
      attRepo.deleteAttachmentsByTradeId(id).catch((err) => {
        console.error(`Failed to delete attachments for deleted trade ${id}:`, err);
      });
    }
    return true;
  }

  /**
   * Adds many trades in one write (import). Trades whose id is already live are skipped; a tombstone with the same
   * id (e.g. an undone import of the same file) is replaced. Returns how many were added.
   */
  importTrades(trades: Trade[]): number {
    const data = this.loadData();
    const liveIds = new Set(data.trades.filter(isLive).map((t) => t.id));
    let added = 0;
    for (const t of trades) {
      if (liveIds.has(t.id)) continue;
      const index = data.trades.findIndex((x) => x.id === t.id);
      const fresh = { ...t, updatedAt: this.stampAfter(index >= 0 ? data.trades[index].updatedAt : undefined), deletedAt: null };
      if (index >= 0) data.trades[index] = fresh;
      else data.trades.push(fresh);
      liveIds.add(t.id);
      added++;
    }
    this.saveData(data);
    return added;
  }

  /** Deletes every trade of one import batch (undo import), including their screenshots. Returns the number deleted. */
  deleteTradesByBatch(batchId: string): number {
    const data = this.loadData();
    const removed = data.trades.filter((t) => t.importBatchId === batchId && isLive(t));
    if (removed.length === 0) return 0;
    removed.forEach((t) => {
      const at = this.stampAfter(t.updatedAt);
      t.deletedAt = at;
      t.updatedAt = at;
    });
    this.saveData(data);
    if (typeof window !== "undefined") {
      const attRepo = new IndexedDBAttachmentRepository(this.userId);
      removed.forEach((t) =>
        attRepo.deleteAttachmentsByTradeId(t.id).catch((err) => {
          console.error(`Failed to delete attachments for trade ${t.id}:`, err);
        })
      );
    }
    return removed.length;
  }

  getStrategies(): Strategy[] {
    return live(this.loadData().strategies || []);
  }

  getStrategy(id: string): Strategy | null {
    return this.getStrategies().find((s) => s.id === id) || null;
  }

  saveStrategy(strategy: Strategy): Strategy {
    const data = this.loadData();
    const saved = this.upsert(data.strategies, strategy, (s) => s.id === strategy.id);
    this.saveData(data);
    return saved;
  }

  archiveStrategy(id: string): Strategy {
    const data = this.loadData();
    const strategy = data.strategies.find((s) => s.id === id && isLive(s));
    if (!strategy) throw new Error(`Strategy not found: ${id}`);
    strategy.archivedAt = this.now();
    strategy.updatedAt = this.stampAfter(strategy.updatedAt);
    this.saveData(data);
    return strategy;
  }

  deleteStrategy(id: string): boolean {
    const data = this.loadData();
    if (data.trades.some((t) => t.strategyId === id && isLive(t))) {
      throw new Error("Cannot delete strategy with trades. Archive it instead.");
    }
    if (!this.softDelete(data.strategies, (s) => s.id === id)) return false;
    this.saveData(data);
    return true;
  }

  getNoTrades(): NoTradeEntry[] {
    return live(this.loadData().noTrades || []);
  }

  getNoTrade(id: string): NoTradeEntry | null {
    return this.getNoTrades().find((e) => e.id === id) || null;
  }

  saveNoTrade(entry: NoTradeEntry): NoTradeEntry {
    const data = this.loadData();
    const saved = this.upsert(data.noTrades, entry, (e) => e.id === entry.id);
    this.saveData(data);
    return saved;
  }

  deleteNoTrade(id: string): boolean {
    const data = this.loadData();
    if (!this.softDelete(data.noTrades, (e) => e.id === id)) return false;
    this.saveData(data);
    return true;
  }

  getStorageUsage(): StorageUsage {
    return AppStorage.getStorageUsage(this.userId);
  }
}

export const defaultJournalRepository = new LocalStorageJournalRepository();
