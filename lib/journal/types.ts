import type { InitialSyncPlan, InitialSyncResult } from "./cloud/sync-engine";
import type { AttachmentMetadata } from "./attachments/types";

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

export type PropValueType = "percent" | "money";
export type PropDailyLossBase = "initialBalance" | "startOfDayBalance";
export type PropDrawdownMode = "static" | "trailingClosed";
export type PropUserOutcome = "passed" | "failed" | "ended";

export interface PropValueLimit {
  type: PropValueType;
  value: number;
}

export interface PropDailyLossLimit extends PropValueLimit {
  base: PropDailyLossBase;
}

export interface PropDrawdownLimit extends PropValueLimit {
  mode: PropDrawdownMode;
  lockAtInitial?: boolean;
}

export interface PropConsistencyRule {
  maxSingleDayShare: number; // Percentage (e.g. 50 for 50%)
}

export interface PropDayReset {
  timezone: string; // IANA timezone string, e.g. "America/New_York"
  hour: number; // 0-23
}

export interface PropRulesSnapshot {
  phaseLabel?: string;
  initialBalance?: number;
  profitTarget?: PropValueLimit;
  maxDailyLoss?: PropDailyLossLimit;
  maxTotalDrawdown?: PropDrawdownLimit;
  minTradingDays?: number;
  maxTradingDays?: number;
  minTradingDayMinPnl?: number;
  consistencyRule?: PropConsistencyRule;
  dayReset?: PropDayReset;
  startedAt: string;
  note?: string;
}

export interface PropPhaseArchive {
  phaseLabel: string;
  initialBalance: number;
  startedAt: string; // ISO String
  endedAt: string; // ISO String
  userOutcome?: PropUserOutcome;
  finalBalance: number;
  closedPnl: number;
  tradingDays: number;
  maxDailyLossUsedPct?: number; // % of daily limit used
  maxDrawdownUsedPct?: number; // % of drawdown limit used
  profitTargetProgressPct?: number; // % of target reached
  note?: string;
  propRulesSnapshot: PropRulesSnapshot;
}

export interface PropRules {
  phaseLabel?: string; // e.g. "Phase 1", max 40 chars
  initialBalance?: number;
  profitTarget?: PropValueLimit;
  maxDailyLoss?: PropDailyLossLimit;
  maxTotalDrawdown?: PropDrawdownLimit;
  minTradingDays?: number;
  maxTradingDays?: number;
  minTradingDayMinPnl?: number;
  consistencyRule?: PropConsistencyRule;
  dayReset?: PropDayReset;
  startedAt: string; // ISO String
  note?: string; // Max 300 chars
  phaseHistory?: PropPhaseArchive[];
}

export type PropLimitType = "dailyLoss" | "totalDrawdown" | "profitTarget" | "tradingDays";
export type PropLimitStatus = "ok" | "caution" | "close" | "reached";

export interface PropToastLogEntry {
  dayKey: string; // Prop firm day key (e.g. YYYY-MM-DD)
  shown: string[]; // List of shown level tokens, e.g. ["dailyLoss:caution", "totalDrawdown:close"]
}

export type PropToastLog = Record<string, PropToastLogEntry>; // accountId -> entry

/**
 * Sync metadata of every journal record (T7b). updatedAt: last local change (ISO); deletedAt: soft delete —
 * the record stays as a tombstone for sync but is never shown, counted or exported.
 */
export interface SyncMeta {
  updatedAt?: string;
  deletedAt?: string | null;
}

/**
 * A screenshot of a trade as the journal knows it (0005): its description only, synced like any record
 * (table journal_attachments). The image itself lives in the browser (IndexedDB) and in the cloud bucket.
 */
export interface JournalAttachment extends AttachmentMetadata, SyncMeta {}

/**
 * Where a screenshot is, for the trade card: inCloud / downloading — not here, its file is in the cloud;
 * noSpace — here, waiting: the cloud has no space for it; none — nothing to say.
 */
export type AttachmentCloudState = "inCloud" | "downloading" | "noSpace" | "none";

export interface Account extends SyncMeta {
  id: string;
  name: string | null; // null for default name ("Основной счёт" / "Main account")
  type: AccountType;
  currency: AccountCurrency;
  startBalance?: number;
  platform: "manual";
  archivedAt?: string | null;
  createdAt: string; // ISO String
  isPrimaryProp?: boolean;
  propRules?: PropRules | null;
}

export type TradeDirection = "long" | "short";
export type TradeStatus = "open" | "closed";
export type TradeResult = "win" | "loss" | "breakeven";
export type TradeSession = "asia" | "london" | "newyork" | "overlap" | "other";
/** How results are shown: R multiples, account money, percent of the account. */
export type JournalUnit = "R" | "money" | "percent";
/** Journal settings; a missing field = behave as before (last used account, last unit switch, no session). */
export interface JournalPreferences {
  defaultUnit?: JournalUnit;
  mainAccountId?: string | null;
  defaultSession?: TradeSession | null;
}
export type TradeVerification = "unverified" | "imported" | "connected" | "verified";
export type TradeSource = "manual" | "import";
/** How the trade ended according to the source file: take profit, stop loss or breakeven. */
export type TradeOutcome = "tp" | "sl" | "be";

export interface Trade extends SyncMeta {
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
  swap?: number; // Swap / financing in account money (signed), imported trades
  riskAmount?: number; // Risk in account money
  riskPercent?: number; // Risk in % of the account (imported files that give it)
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
  attachmentIds?: string[];
  /** Import batch that created this trade (lets the user undo one import). */
  importBatchId?: string;
  /** Duplicate-protection key: platform ticket/ID or a hash of instrument+time+price+size. */
  importKey?: string;
  /** Ticket / position / trade ID in the source platform. */
  externalId?: string;
  /** Take profit / stop loss / breakeven, as given by the imported file. */
  outcome?: TradeOutcome;
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

export interface Strategy extends SyncMeta {
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

export interface NoTradeEntry extends SyncMeta {
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

export interface PlanBiasItem {
  instrument: string; // UPPERCASE
  direction: "bullish" | "bearish" | "neutral";
  note?: string; // Max 200 chars
}

export interface PlanLevelItem {
  instrument?: string; // UPPERCASE
  price?: number;
  label?: string; // Max 80 chars
}

export interface PlanEventItem {
  time?: string; // e.g. "14:30" or ISO
  text?: string; // Max 120 chars
}

export interface PlanLimits {
  maxRiskPerTrade?: RiskLimit;
  maxDailyLoss?: RiskLimit;
  maxTrades?: number;
}

export interface PlanChecklistItem {
  key?: string; // Dictionary key for standard items (e.g., "bias_defined")
  text?: string; // Custom item text
  done: boolean;
}

export interface DayReview {
  rating: number; // 1-5
  followedPlan: "yes" | "partly" | "no";
  emotions: string[]; // catalog emotion IDs
  whatWorked?: string; // Max 300 chars
  whatToImprove?: string; // Max 300 chars
  lesson?: string; // Max 300 chars
  completedAt?: string; // ISO String
}

export interface TradingPlan extends SyncMeta {
  date: string; // YYYY-MM-DD
  bias: PlanBiasItem[]; // Max 8
  levels: PlanLevelItem[]; // Max 12
  events: PlanEventItem[]; // Max 8
  limits?: PlanLimits;
  checklist: PlanChecklistItem[];
  note?: string; // Max 500 chars
  review?: DayReview;
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
}

export interface WeekPlan extends SyncMeta {
  weekStartDate: string; // YYYY-MM-DD (Monday)
  goals: string[]; // Max 3, each max 120 chars
  focus?: string; // Strategy ID or custom text
  summary?: string; // Max 500 chars
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
}

export type NoteTemplateKey =
  | "session_review"
  | "weekly_mistake"
  | "idea"
  | "lesson";

export interface NoteLinks {
  tradeId?: string;
  date?: string; // YYYY-MM-DD
  instrument?: string; // UPPERCASE
  strategyId?: string;
}

export interface Note extends SyncMeta {
  id: string;
  title?: string; // Max 80 chars
  body: string; // Max 5000 chars
  tags: string[]; // Max 8 tags, each max 24 chars
  pinned: boolean;
  links?: NoteLinks;
  templateKey?: NoteTemplateKey;
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  archivedAt?: string | null;
}

export interface JournalRepository {
  getPrimaryPropAccountId(): string | null | undefined;
  setPrimaryPropAccountId(id: string | null | undefined): void;
  /** Journal settings (default unit, main account, default session); synced with primaryPropAccountId. */
  getPreferences(): JournalPreferences;
  setPreferences(preferences: JournalPreferences): void;
  getAccounts(): Account[];
  getAccount(id: string): Account | null;
  saveAccount(account: Account): Account;
  archiveAccount(id: string): Account;
  deleteAccount(id: string): boolean;

  getTrades(): Trade[];
  getTrade(id: string): Trade | null;
  saveTrade(trade: Trade): Trade;
  deleteTrade(id: string): boolean;
  importTrades(trades: Trade[]): number;
  deleteTradesByBatch(batchId: string): number;

  getStrategies(): Strategy[];
  getStrategy(id: string): Strategy | null;
  saveStrategy(strategy: Strategy): Strategy;
  archiveStrategy(id: string): Strategy;
  deleteStrategy(id: string): boolean;

  getNoTrades(): NoTradeEntry[];
  getNoTrade(id: string): NoTradeEntry | null;
  saveNoTrade(entry: NoTradeEntry): NoTradeEntry;
  deleteNoTrade(id: string): boolean;

  getTradingPlan(date: string): TradingPlan | null;
  getTradingPlans(): TradingPlan[];
  saveTradingPlan(plan: TradingPlan): TradingPlan;
  deleteTradingPlan(date: string): boolean;

  getWeekPlan(weekStartDate: string): WeekPlan | null;
  getWeekPlans(): WeekPlan[];
  saveWeekPlan(plan: WeekPlan): WeekPlan;
  deleteWeekPlan(weekStartDate: string): boolean;

  getNotes(): Note[];
  getNote(id: string): Note | null;
  saveNote(note: Note): Note;
  archiveNote(id: string): Note;
  deleteNote(id: string): boolean;

  getStorageUsage(): StorageUsage;

  /** Screenshot descriptions of the journal (0005). Live only, unless `withDeleted`. */
  getAttachmentRecords?(withDeleted?: boolean): JournalAttachment[];
  /** A screenshot added on this device (its file is already in the browser). */
  saveAttachmentRecord?(meta: AttachmentMetadata): JournalAttachment;
  /** Type or caption changed. */
  updateAttachmentRecord?(id: string, updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>): JournalAttachment | null;
  /** Soft delete: the description stays as a tombstone, the file in the cloud stays 30 days (0005). */
  deleteAttachmentRecord?(id: string): boolean;
  /** «Undo» of a deletion. */
  restoreAttachmentRecord?(id: string): JournalAttachment | null;
  /** Cloud journal: where a screenshot that is not on this device is — its file is in the cloud / being downloaded. */
  attachmentCloudState?(id: string): AttachmentCloudState;
  /** Cloud journal: download one screenshot's file now («Download» in manual mode). */
  downloadAttachment?(id: string, opts?: { byUser?: boolean }): Promise<boolean>;
  /** Cloud journal: files arrived or left this browser. Returns unsubscribe. */
  subscribeAttachmentFiles?(listener: () => void): () => void;

  /** Everything stored, including tombstones (deletedAt set) — for sync (T7b) and tests; never for the UI. */
  getAllRecords(): JournalSnapshot;

  /** Optional: notifies when records changed outside the UI (e.g. arrived from the cloud). Returns unsubscribe. */
  subscribe?(listener: () => void): () => void;

  /** Optional (cloud journal): is the cloud used for this account now (flag on, signed in)? */
  isCloudActive?(): boolean;
  /** The server already answered whether cloud sync is on for the signed-in account (guests: true). */
  isCloudFlagKnown?(): boolean;
  /** Queue for the cloud the records written outside the repository (guest journal copied in). */
  adoptLocalRecords?(): number;
  /** Optional (cloud journal): records changed both here and in the cloud, waiting for the user's choice. */
  listConflicts?(): SyncConflict[];
  /** Optional (cloud journal): "keep this device" / "take from cloud" for one record. */
  resolveConflict?(table: string, id: string, choice: SyncConflictChoice): boolean;
  /** Optional (cloud journal): notifies when the sync status (incl. conflicts) changes. */
  subscribeStatus?(listener: () => void): () => void;
  /** Optional (cloud journal): is the first upload of this device's journal needed / was it started? */
  getInitialSyncInfo?(): { needed: boolean; started: boolean };
  /** Optional (cloud journal): records an empty device downloaded by itself (one notice), then forgotten. */
  takeCloudDownloadNotice?(): number | null;
  /** Optional (cloud journal): state of the exchange with the cloud (the badge in the header). */
  /** Auto / manual exchange on this device (cloud repository only). */
  getSyncMode?(): "auto" | "manual";
  setSyncMode?(mode: "auto" | "manual"): void;
  getCloudStatus?(): { state: "local" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error" | "manual"; pending: number; blocked: unknown[]; conflicts: number; lastError?: string; lastSyncAt?: string; noSpace?: number };
  /** Optional (cloud journal): exchange with the cloud now ("Retry"). */
  syncNow?(): Promise<void>;
  /** Optional (cloud journal): preview of the first upload. */
  analyzeInitialSync?(): Promise<InitialSyncPlan>;
  /** Optional (cloud journal): the first upload (button), with progress and cancel. */
  runInitialSync?(opts?: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }): Promise<InitialSyncResult>;
}

export type SyncConflictChoice = "device" | "cloud";

/** A record changed on this device and in the cloud differently (T7b-4b). The device version is the one in the journal. */
export interface SyncConflict {
  /** Cloud table: journal_trades, journal_notes, ... */
  table: string;
  id: string;
  /** The cloud version of the record. */
  cloud: Record<string, unknown>;
  detectedAt: string;
}

/** Full journal contents including soft-deleted records. */
export interface JournalSnapshot {
  schemaVersion: number;
  primaryPropAccountId?: string | null;
  /** Journal settings of the account (docs/journal-setup-plan.md). */
  preferences?: JournalPreferences;
  /** When primaryPropAccountId or preferences last changed (sync). */
  settingsUpdatedAt?: string;
  accounts: Account[];
  trades: Trade[];
  strategies: Strategy[];
  noTrades: NoTradeEntry[];
  plans: TradingPlan[];
  weekPlans: WeekPlan[];
  notes: Note[];
  /** Screenshot descriptions (0005); absent in journals stored before it. */
  attachments?: JournalAttachment[];
}
