export type AccountType = "personal" | "prop" | "demo";

export type AccountCurrency =
  | "USD"
  | "EUR"
  | "GBP"
  | "GEL"
  | "RUB"
  | "UAH"
  | "KZT"
  | "USDT";

export interface Account {
  id: string;
  name: string | null; // null for default name ("Основной счёт" / "Main account")
  type: AccountType;
  currency: AccountCurrency;
  startBalance?: number;
  platform: "manual";
  archivedAt?: string | null;
  createdAt: string; // ISO String
  propRules?: Record<string, unknown> | null; // Placeholder for T6d
}

export type TradeDirection = "long" | "short";
export type TradeStatus = "open" | "closed";
export type TradeResult = "win" | "loss" | "breakeven";
export type TradeSession = "asia" | "london" | "newyork" | "overlap" | "other";
export type TradeVerification = "unverified" | "imported" | "connected" | "verified";
export type TradeSource = "manual";

export interface Trade {
  id: string;
  accountId: string;
  instrument: string; // Normalized to UPPERCASE without spaces
  direction: TradeDirection;
  status: TradeStatus;
  openedAt: string; // ISO String
  closedAt?: string; // ISO String
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  size?: number;
  fees?: number;
  riskAmount?: number; // Risk in account money
  pnlMoney?: number; // Net result in money
  rMultiple?: number; // Entered or calculated R
  result: TradeResult; // Derived/calculated
  strategyId?: string; // Placeholder for T6c
  session?: TradeSession;
  emotions: string[]; // Emotion IDs catalog
  entryReason?: string; // Max 500 chars
  mistakes: string[]; // Mistake IDs catalog
  executionRating?: number; // 1-5
  notes?: string; // Max 1000 chars
  verification: TradeVerification; // 'unverified' for manual
  source: TradeSource; // 'manual'
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  schemaVersion: number;
}

export const INSTRUMENT_AUTOCOMPLETE = [
  "XAUUSD",
  "NAS100",
  "US30",
  "SPX500",
  "GER40",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USOIL",
  "UKOIL",
  "BTCUSD",
  "ETHUSD",
] as const;

export const EMOTIONS_CATALOG = [
  "calm",
  "confident",
  "focused",
  "anxious",
  "fearful",
  "greedy",
  "impatient",
  "frustrated",
  "euphoric",
  "bored",
  "tired",
  "revenge",
] as const;

export const MISTAKES_CATALOG = [
  "early_entry",
  "late_entry",
  "no_stop",
  "moved_stop",
  "oversized",
  "overtrading",
  "revenge_trade",
  "ignored_plan",
  "fomo",
  "exited_early",
  "held_too_long",
  "news_ignored",
  "other",
] as const;

export const SESSIONS_CATALOG = [
  "asia",
  "london",
  "newyork",
  "overlap",
  "other",
] as const;

export interface StorageUsage {
  bytesUsed: number;
  bytesLimit: number;
  percentage: number;
  isWarning: boolean;
}

export interface JournalRepository {
  getAccounts(): Account[];
  getAccount(id: string): Account | null;
  saveAccount(account: Account): Account;
  archiveAccount(id: string): Account;
  deleteAccount(id: string): boolean;

  getTrades(): Trade[];
  getTrade(id: string): Trade | null;
  saveTrade(trade: Trade): Trade;
  deleteTrade(id: string): boolean;

  getStorageUsage(): StorageUsage;
}
