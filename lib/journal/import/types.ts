import type { TradeDirection, TradeOutcome, TradeSession } from "../types";

/** A table read from a file: CSV/TSV, one XLSX sheet or one HTML table. Cells are raw strings. */
export interface RawTable {
  kind: "csv" | "xlsx" | "html" | "json";
  /** Sheet name (XLSX) or table index (HTML). */
  name?: string;
  rows: string[][];
  /** Parsed JSON payload for kind "json". */
  json?: unknown;
}

export type ImportFormatId =
  | "mt4"
  | "mt5"
  | "ctrader"
  | "matchtrader"
  | "dxtrade"
  | "tradelocker"
  | "tradingview"
  | "ninjatrader"
  | "tradovate"
  | "rithmic"
  | "sierrachart"
  | "ibkr"
  | "thinkorswim"
  | "tastytrade"
  | "webull"
  | "binance"
  | "bybit"
  | "okx"
  | "kucoin"
  | "bitget"
  | "mexc"
  | "bingx"
  | "gateio"
  | "kraken"
  | "coinbase"
  | "universal"
  | "ayra";

export type ImportPlatformGroup = "forex" | "futures" | "stocks" | "crypto" | "other";

/** Fields of a trade that a file column can be mapped to (universal CSV). Stored as ids, never as labels. */
export type ImportField =
  | "instrument"
  | "direction"
  | "openedAt"
  | "closedAt"
  | "entryPrice"
  | "exitPrice"
  | "size"
  | "pnl"
  | "commission"
  | "swap"
  | "stopLoss"
  | "takeProfit"
  | "externalId"
  | "rMultiple"
  | "riskPercent"
  | "outcome"
  | "session"
  | "strategy";

/** Column index per field; -1 = the user chose "not used" (kept so a remembered mapping is not re-guessed). */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/** A trade as read from a file, before it is attached to an account and saved. Times are UTC ISO strings. */
export interface NormalizedTrade {
  externalId?: string;
  instrument: string;
  direction: TradeDirection;
  openedAt: string;
  closedAt?: string;
  entryPrice?: number;
  exitPrice?: number;
  size?: number;
  /** Result in account currency as given by the platform: gross (before commission and swap) unless profitIsNet. */
  profit?: number;
  /** The profit column already includes commission and swap (universal files, some exports). */
  profitIsNet?: boolean;
  /** Commission as a positive cost. */
  commission?: number;
  /** Swap / financing (signed: negative is a cost). */
  swap?: number;
  stopLoss?: number;
  takeProfit?: number;
  currency?: string;
  notes?: string;
  /** Realized R given by the file (e.g. an "RR" column). */
  rMultiple?: number;
  /** Risk in % of the account given by the file. */
  riskPercent?: number;
  outcome?: TradeOutcome;
  session?: TradeSession;
  /** Strategy / setup name as written in the file; matched to the user's strategies by name. */
  strategyName?: string;
  /** Extra data carried by the AYRA JSON format (strategy, tags, mistakes...). */
  ayra?: Record<string, unknown>;
  /** 1-based row numbers in the file this trade was built from. */
  rows: number[];
}

export type RowErrorCode =
  | "missingInstrument"
  | "missingDirection"
  | "missingTime"
  | "badTime"
  | "badNumber"
  | "unpairedFill"
  | "unsupportedRow";

export interface RowError {
  row: number;
  code: RowErrorCode;
  /** Column header or field id the problem refers to (not a translated text). */
  field?: string;
}

export interface ParseOptions {
  /** IANA timezone used for times without an explicit offset. */
  timeZone: string;
  /** Manual column mapping (universal format). */
  mapping?: ColumnMapping;
  /** Header row index chosen for the universal format. */
  headerRow?: number;
}

export interface ParseResult {
  trades: NormalizedTrade[];
  errors: RowError[];
  /** Timezone found in the file itself (e.g. "UTC+3" in a header), if any. */
  detectedTimeZone?: string;
  currency?: string;
}

export interface ImportParser {
  id: ImportFormatId;
  group: ImportPlatformGroup;
  /** File kinds this parser understands. */
  kinds: RawTable["kind"][];
  /** 0 = not this format, 1 = certain. */
  detect(table: RawTable): number;
  parse(table: RawTable, options: ParseOptions): ParseResult;
  /** "documented" = built from published column docs, "verified" = checked on a real file. */
  verification: "verified" | "documented";
}
