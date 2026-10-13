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
} from "./types";
import { defaultAttachmentRepository, IndexedDBAttachmentRepository } from "./attachments/indexeddb-repository";
import { AppStorage, parseKey } from "@/lib/storage";

const JOURNAL_STORAGE_KEY = "ayra_journal_v1";
const CURRENT_JOURNAL_SCHEMA_VERSION = 5;
const STORAGE_WARN_THRESHOLD = 0.8; // 80%

export interface JournalStorageData {
  schemaVersion: number;
  primaryPropAccountId?: string | null;
  accounts: Account[];
  trades: Trade[];
  strategies: Strategy[];
  noTrades: NoTradeEntry[];
  plans: TradingPlan[];
  weekPlans: WeekPlan[];
  notes: Note[];
}

export const INITIAL_JOURNAL_DATA: JournalStorageData = {
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

export class LocalStorageJournalRepository implements JournalRepository {
  private key: string;
  private userId?: string | null;

  constructor(key = JOURNAL_STORAGE_KEY, userId?: string | null) {
    this.key = key;
    this.userId = userId;
  }

  private loadData(): JournalStorageData {
    if (typeof window === "undefined") {
      return INITIAL_JOURNAL_DATA;
    }

    try {
      const raw = AppStorage.getItem(this.key, this.userId);
      if (!raw) return INITIAL_JOURNAL_DATA;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return INITIAL_JOURNAL_DATA;

      return this.migrate(parsed);
    } catch (e) {
      console.error("Failed to load journal data from storage, falling back to initial", e);
      return INITIAL_JOURNAL_DATA;
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

  private migrate(raw: any): JournalStorageData {
    let rawAccounts: Account[] = Array.isArray(raw.accounts) ? raw.accounts : [];
    const rawTrades: any[] = Array.isArray(raw.trades) ? raw.trades : [];
    const rawStrategies: Strategy[] = Array.isArray(raw.strategies) ? raw.strategies : [];
    const rawNoTrades: NoTradeEntry[] = Array.isArray(raw.noTrades) ? raw.noTrades : [];
    const rawPlans: TradingPlan[] = Array.isArray(raw.plans) ? raw.plans : [];
    const rawWeekPlans: WeekPlan[] = Array.isArray(raw.weekPlans) ? raw.weekPlans : [];
    const rawNotes: Note[] = Array.isArray(raw.notes) ? raw.notes : [];

    // Migration v5: Migrate primaryPropAccountId
    let primaryPropAccountId: string | null | undefined = raw.primaryPropAccountId;

    rawAccounts = rawAccounts.map((acc) => {
      const isProp = acc.type === "prop";
      return {
        ...acc,
        propRules: isProp && acc.propRules ? acc.propRules : (acc.type === "prop" ? acc.propRules || null : null),
      };
    });

    // If primaryPropAccountId was not stored explicitly (undefined), check legacy isPrimaryProp flag
    if (primaryPropAccountId === undefined) {
      const legacyPrimary = rawAccounts.find(
        (a) => a.isPrimaryProp && a.type === "prop" && !a.archivedAt
      );
      if (legacyPrimary) {
        primaryPropAccountId = legacyPrimary.id;
      }
    }

    const trades: Trade[] = rawTrades.map((t) => ({
      ...t,
      strategyId: t.strategyId ?? null,
      strategyVersion: t.strategyVersion ?? null,
      ruleChecks: t.ruleChecks ?? {},
      processScore: typeof t.processScore === "number" ? t.processScore : null,
      processScoreSnapshot: t.processScoreSnapshot ?? null,
      attachmentIds: Array.isArray(t.attachmentIds) ? t.attachmentIds : [],
      schemaVersion: CURRENT_JOURNAL_SCHEMA_VERSION,
    }));

    return {
      schemaVersion: CURRENT_JOURNAL_SCHEMA_VERSION,
      primaryPropAccountId,
      accounts: rawAccounts,
      trades,
      strategies: rawStrategies,
      noTrades: rawNoTrades,
      plans: rawPlans,
      weekPlans: rawWeekPlans,
      notes: rawNotes,
    };
  }

  getPrimaryPropAccountId(): string | null | undefined {
    return this.loadData().primaryPropAccountId;
  }

  setPrimaryPropAccountId(id: string | null | undefined): void {
    const data = this.loadData();
    data.primaryPropAccountId = id;
    this.saveData(data);
  }

  getAccounts(): Account[] {
    return this.loadData().accounts;
  }

  getAccount(id: string): Account | null {
    const accounts = this.getAccounts();
    return accounts.find((a) => a.id === id) || null;
  }

  saveAccount(account: Account): Account {
    const data = this.loadData();
    const index = data.accounts.findIndex((a) => a.id === account.id);

    if (index >= 0) {
      data.accounts[index] = account;
    } else {
      data.accounts.push(account);
    }

    this.saveData(data);
    return account;
  }

  archiveAccount(id: string): Account {
    const data = this.loadData();
    const account = data.accounts.find((a) => a.id === id);
    if (!account) throw new Error(`Account not found: ${id}`);

    account.archivedAt = new Date().toISOString();
    this.saveData(data);
    return account;
  }

  deleteAccount(id: string): boolean {
    const data = this.loadData();
    // Cannot delete if there are trades
    const hasTrades = data.trades.some((t) => t.accountId === id);
    if (hasTrades) {
      throw new Error("Cannot delete account with trades. Archive it instead.");
    }

    const filtered = data.accounts.filter((a) => a.id !== id);
    if (filtered.length === data.accounts.length) return false;

    data.accounts = filtered;
    this.saveData(data);
    return true;
  }

  getTradingPlans(): TradingPlan[] {
    return this.loadData().plans || [];
  }

  getTradingPlan(date: string): TradingPlan | null {
    const plans = this.getTradingPlans();
    return plans.find((p) => p.date === date) || null;
  }

  saveTradingPlan(plan: TradingPlan): TradingPlan {
    const data = this.loadData();
    const index = data.plans.findIndex((p) => p.date === plan.date);

    if (index >= 0) {
      data.plans[index] = plan;
    } else {
      data.plans.push(plan);
    }

    this.saveData(data);
    return plan;
  }

  deleteTradingPlan(date: string): boolean {
    const data = this.loadData();
    const filtered = data.plans.filter((p) => p.date !== date);
    if (filtered.length === data.plans.length) return false;

    data.plans = filtered;
    this.saveData(data);
    return true;
  }

  getWeekPlans(): WeekPlan[] {
    return this.loadData().weekPlans || [];
  }

  getWeekPlan(weekStartDate: string): WeekPlan | null {
    const weekPlans = this.getWeekPlans();
    return weekPlans.find((p) => p.weekStartDate === weekStartDate) || null;
  }

  saveWeekPlan(plan: WeekPlan): WeekPlan {
    const data = this.loadData();
    const index = data.weekPlans.findIndex((p) => p.weekStartDate === plan.weekStartDate);

    if (index >= 0) {
      data.weekPlans[index] = plan;
    } else {
      data.weekPlans.push(plan);
    }

    this.saveData(data);
    return plan;
  }

  deleteWeekPlan(weekStartDate: string): boolean {
    const data = this.loadData();
    const filtered = data.weekPlans.filter((p) => p.weekStartDate !== weekStartDate);
    if (filtered.length === data.weekPlans.length) return false;

    data.weekPlans = filtered;
    this.saveData(data);
    return true;
  }

  getNotes(): Note[] {
    return this.loadData().notes || [];
  }

  getNote(id: string): Note | null {
    const notes = this.getNotes();
    return notes.find((n) => n.id === id) || null;
  }

  saveNote(note: Note): Note {
    const data = this.loadData();
    const index = data.notes.findIndex((n) => n.id === note.id);

    if (index >= 0) {
      data.notes[index] = note;
    } else {
      data.notes.push(note);
    }

    this.saveData(data);
    return note;
  }

  archiveNote(id: string): Note {
    const data = this.loadData();
    const note = data.notes.find((n) => n.id === id);
    if (!note) throw new Error(`Note not found: ${id}`);

    note.archivedAt = new Date().toISOString();
    note.updatedAt = new Date().toISOString();
    this.saveData(data);
    return note;
  }

  deleteNote(id: string): boolean {
    const data = this.loadData();
    const filtered = data.notes.filter((n) => n.id !== id);
    if (filtered.length === data.notes.length) return false;

    data.notes = filtered;
    this.saveData(data);
    return true;
  }

  getTrades(): Trade[] {
    return this.loadData().trades;
  }

  getTrade(id: string): Trade | null {
    const trades = this.getTrades();
    return trades.find((t) => t.id === id) || null;
  }

  saveTrade(trade: Trade): Trade {
    const data = this.loadData();
    const index = data.trades.findIndex((t) => t.id === trade.id);

    if (index >= 0) {
      data.trades[index] = trade;
    } else {
      data.trades.push(trade);
    }

    this.saveData(data);
    return trade;
  }

  deleteTrade(id: string): boolean {
    const data = this.loadData();
    const filtered = data.trades.filter((t) => t.id !== id);
    if (filtered.length === data.trades.length) return false;

    data.trades = filtered;
    this.saveData(data);

    // Asynchronously delete attachments for this trade in background
    if (typeof window !== "undefined") {
      const attRepo = new IndexedDBAttachmentRepository(this.userId);
      attRepo.deleteAttachmentsByTradeId(id).catch((err) => {
        console.error(`Failed to delete attachments for deleted trade ${id}:`, err);
      });
    }

    return true;
  }

  /** Adds many trades in one write (import). Trades whose id already exists are skipped. Returns how many were added. */
  importTrades(trades: Trade[]): number {
    const data = this.loadData();
    const ids = new Set(data.trades.map((t) => t.id));
    const fresh = trades.filter((t) => !ids.has(t.id));
    data.trades.push(...fresh);
    this.saveData(data);
    return fresh.length;
  }

  /** Deletes every trade of one import batch (undo import), including their screenshots. Returns the number deleted. */
  deleteTradesByBatch(batchId: string): number {
    const data = this.loadData();
    const removed = data.trades.filter((t) => t.importBatchId === batchId);
    if (removed.length === 0) return 0;
    data.trades = data.trades.filter((t) => t.importBatchId !== batchId);
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
    return this.loadData().strategies || [];
  }

  getStrategy(id: string): Strategy | null {
    const strategies = this.getStrategies();
    return strategies.find((s) => s.id === id) || null;
  }

  saveStrategy(strategy: Strategy): Strategy {
    const data = this.loadData();
    const index = data.strategies.findIndex((s) => s.id === strategy.id);

    if (index >= 0) {
      data.strategies[index] = strategy;
    } else {
      data.strategies.push(strategy);
    }

    this.saveData(data);
    return strategy;
  }

  archiveStrategy(id: string): Strategy {
    const data = this.loadData();
    const strategy = data.strategies.find((s) => s.id === id);
    if (!strategy) throw new Error(`Strategy not found: ${id}`);

    strategy.archivedAt = new Date().toISOString();
    this.saveData(data);
    return strategy;
  }

  deleteStrategy(id: string): boolean {
    const data = this.loadData();
    const hasTrades = data.trades.some((t) => t.strategyId === id);
    if (hasTrades) {
      throw new Error("Cannot delete strategy with trades. Archive it instead.");
    }

    const filtered = data.strategies.filter((s) => s.id !== id);
    if (filtered.length === data.strategies.length) return false;

    data.strategies = filtered;
    this.saveData(data);
    return true;
  }

  getNoTrades(): NoTradeEntry[] {
    return this.loadData().noTrades || [];
  }

  getNoTrade(id: string): NoTradeEntry | null {
    const entries = this.getNoTrades();
    return entries.find((e) => e.id === id) || null;
  }

  saveNoTrade(entry: NoTradeEntry): NoTradeEntry {
    const data = this.loadData();
    const index = data.noTrades.findIndex((e) => e.id === entry.id);

    if (index >= 0) {
      data.noTrades[index] = entry;
    } else {
      data.noTrades.push(entry);
    }

    this.saveData(data);
    return entry;
  }

  deleteNoTrade(id: string): boolean {
    const data = this.loadData();
    const filtered = data.noTrades.filter((e) => e.id !== id);
    if (filtered.length === data.noTrades.length) return false;

    data.noTrades = filtered;
    this.saveData(data);
    return true;
  }

  getStorageUsage(): StorageUsage {
    return AppStorage.getStorageUsage(this.userId);
  }
}

export const defaultJournalRepository = new LocalStorageJournalRepository();
