import { Account, Trade, StorageUsage, JournalRepository } from "./types";

const JOURNAL_STORAGE_KEY = "ayra_journal_v1";
const STORAGE_WARN_THRESHOLD = 0.8; // 80%

export interface JournalStorageData {
  schemaVersion: number;
  accounts: Account[];
  trades: Trade[];
}

export const INITIAL_JOURNAL_DATA: JournalStorageData = {
  schemaVersion: 1,
  accounts: [],
  trades: [],
};

export class LocalStorageJournalRepository implements JournalRepository {
  private key: string;

  constructor(key = JOURNAL_STORAGE_KEY) {
    this.key = key;
  }

  private loadData(): JournalStorageData {
    if (typeof window === "undefined") {
      return INITIAL_JOURNAL_DATA;
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return INITIAL_JOURNAL_DATA;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return INITIAL_JOURNAL_DATA;

      return this.migrate(parsed);
    } catch (e) {
      console.error("Failed to load journal data from localStorage, falling back to initial", e);
      return INITIAL_JOURNAL_DATA;
    }
  }

  private saveData(data: JournalStorageData): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) {
      console.error("Failed to save journal data to localStorage", e);
    }
  }

  private migrate(raw: any): JournalStorageData {
    const version = raw.schemaVersion || 1;
    const accounts: Account[] = Array.isArray(raw.accounts) ? raw.accounts : [];
    const trades: Trade[] = Array.isArray(raw.trades) ? raw.trades : [];

    // Migration logic for future schema versions can go here
    return {
      schemaVersion: version,
      accounts,
      trades,
    };
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
    return true;
  }

  getStorageUsage(): StorageUsage {
    if (typeof window === "undefined") {
      return { bytesUsed: 0, bytesLimit: 5 * 1024 * 1024, percentage: 0, isWarning: false };
    }

    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key);
        if (val) {
          totalBytes += key.length + val.length;
        }
      }
    }

    // Default localStorage limit is usually ~5MB (5,242,880 bytes)
    const limit = 5 * 1024 * 1024;
    const percentage = (totalBytes / limit) * 100;

    return {
      bytesUsed: totalBytes,
      bytesLimit: limit,
      percentage,
      isWarning: percentage >= STORAGE_WARN_THRESHOLD * 100,
    };
  }
}

export const defaultJournalRepository = new LocalStorageJournalRepository();
