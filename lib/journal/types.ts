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
  strategyId?: string | null;
  session?: TradeSession;
  emotions: string[]; // Emotion IDs catalog
  entryReason?: string; // Max 500 chars
  mistakes: string[]; // Mistake IDs catalog
  executionRating?: number; // 1-5
  notes?: string; // Max 1000 chars
  verification: TradeVerification; // 'unverified' for manual
  source: TradeSource; // 'manual'
  strategyVersion?: number | null;
  ruleChecks?: Record<string, RuleCheckValue>;
  processScore?: number | null;
  processScoreSnapshot?: ProcessScoreSnapshot | null;
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  schemaVersion: number;
}

export type RuleGroup = "entry" | "exit" | "risk" | "management";
export type RuleWeight = "required" | "optional";

export interface StrategyRule {
  id: string;
  group: RuleGroup;
  text: string; // Max 120 chars
  weight: RuleWeight;
}

export interface RiskLimit {
  type: "r" | "percent";
  value: number;
}

export interface Strategy {
  id: string;
  name: string | null; // null for default strategy ("Моя стратегия" / "My strategy")
  description?: string | null; // Max 500 chars
  color: string; // Palette color code
  rules: StrategyRule[];
  tags: string[]; // Max 12 tags
  riskLimit?: RiskLimit | null;
  allowedSessions?: TradeSession[] | null;
  version: number;
  archivedAt?: string | null;
  createdAt: string; // ISO String
}

export type RuleCheckValue = "passed" | "failed" | "na";

export interface ProcessScoreComponent {
  key: "rules" | "risk" | "session";
  score: number; // 0-100
  weight: number; // 0-100 percentage
  rawContribution: number;
}

export interface ProcessScoreSnapshot {
  score: number | null;
  formulaVersion: string; // e.g. "1.0"
  components: ProcessScoreComponent[];
  mistakesPenalty: number;
  calculatedAt: string; // ISO String
}

export type NoTradeReason =
  | "setup_incomplete"
  | "outside_session"
  | "risk_limit"
  | "news"
  | "emotional_state"
  | "plan_not_matching"
  | "other";

export interface NoTradeEntry {
  id: string;
  date: string; // ISO String or YYYY-MM-DD
  accountId?: string | null;
  instrument?: string | null; // UPPERCASE
  reason: NoTradeReason;
  note?: string | null; // Max 500 chars
  createdAt: string; // ISO String
}

export const NO_TRADE_REASONS = [
  "setup_incomplete",
  "outside_session",
  "risk_limit",
  "news",
  "emotional_state",
  "plan_not_matching",
  "other",
] as const;

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

  getStrategies(): Strategy[];
  getStrategy(id: string): Strategy | null;
  saveStrategy(strategy: Strategy): Strategy;
  archiveStrategy(id: string): Strategy;
  deleteStrategy(id: string): boolean;

  getNoTrades(): NoTradeEntry[];
  getNoTrade(id: string): NoTradeEntry | null;
  saveNoTrade(entry: NoTradeEntry): NoTradeEntry;
  deleteNoTrade(id: string): boolean;

  getStorageUsage(): StorageUsage;
}
