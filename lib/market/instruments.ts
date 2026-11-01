/**
 * The Market catalog (PR 1.2, 1.3; `docs/market-plan.md` sections 8–9): the D-14 core and the five categories
 * (owner's decision 3), shown with free TradingView widgets. The Chart and the Watchlist pick only from here.
 *
 * Every symbol was checked in the widgets (2026-11-01): exchange feeds such as `TVC:DXY`, `SP:SPX`, `NASDAQ:NDX` and
 * the yields `TVC:US10Y` are "only available on TradingView" there, so the widget-friendly feeds below are used.
 * Bond yields are not available in the widgets at all: the bonds category shows bond prices (a price up = a yield
 * down), and says so.
 */

/** How fresh the data is, as far as it is known for the feed: forex and crypto feeds are real-time, CFD feeds of
 * indices, commodities and bonds may be delayed (the widgets do not say by how much). */
export type DataDelay = "realtime" | "mayDelay";

export const INSTRUMENT_IDS = [
  "dxy",
  "spx",
  "ndx",
  "dji",
  "dax",
  "ftse",
  "nikkei",
  "eurusd",
  "gbpusd",
  "usdjpy",
  "audusd",
  "usdchf",
  "usdcad",
  "nzdusd",
  "btc",
  "eth",
  "sol",
  "gold",
  "silver",
  "platinum",
  "oil",
  "brent",
  "natgas",
  "us02y",
  "us10y",
  "us30y",
  "bund",
  "gilt",
] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

export interface Instrument {
  id: InstrumentId;
  /** TradingView symbol, checked in the widgets. */
  symbol: string;
  /** Short ticker shown next to the name. */
  ticker: string;
  delay: DataDelay;
}

export const INSTRUMENTS: Readonly<Record<InstrumentId, Instrument>> = {
  dxy: { id: "dxy", symbol: "CAPITALCOM:DXY", ticker: "DXY", delay: "mayDelay" },
  spx: { id: "spx", symbol: "FOREXCOM:SPXUSD", ticker: "SPX500", delay: "mayDelay" },
  ndx: { id: "ndx", symbol: "FOREXCOM:NSXUSD", ticker: "NAS100", delay: "mayDelay" },
  dji: { id: "dji", symbol: "FOREXCOM:DJI", ticker: "US30", delay: "mayDelay" },
  dax: { id: "dax", symbol: "FOREXCOM:GRXEUR", ticker: "GER40", delay: "mayDelay" },
  ftse: { id: "ftse", symbol: "FOREXCOM:UKXGBP", ticker: "UK100", delay: "mayDelay" },
  nikkei: { id: "nikkei", symbol: "FOREXCOM:JPXJPY", ticker: "JP225", delay: "mayDelay" },
  eurusd: { id: "eurusd", symbol: "FX:EURUSD", ticker: "EURUSD", delay: "realtime" },
  gbpusd: { id: "gbpusd", symbol: "FX:GBPUSD", ticker: "GBPUSD", delay: "realtime" },
  usdjpy: { id: "usdjpy", symbol: "FX:USDJPY", ticker: "USDJPY", delay: "realtime" },
  audusd: { id: "audusd", symbol: "FX:AUDUSD", ticker: "AUDUSD", delay: "realtime" },
  usdchf: { id: "usdchf", symbol: "FX:USDCHF", ticker: "USDCHF", delay: "realtime" },
  usdcad: { id: "usdcad", symbol: "FX:USDCAD", ticker: "USDCAD", delay: "realtime" },
  nzdusd: { id: "nzdusd", symbol: "FX:NZDUSD", ticker: "NZDUSD", delay: "realtime" },
  btc: { id: "btc", symbol: "BITSTAMP:BTCUSD", ticker: "BTCUSD", delay: "realtime" },
  eth: { id: "eth", symbol: "BITSTAMP:ETHUSD", ticker: "ETHUSD", delay: "realtime" },
  sol: { id: "sol", symbol: "BINANCE:SOLUSDT", ticker: "SOLUSDT", delay: "realtime" },
  gold: { id: "gold", symbol: "OANDA:XAUUSD", ticker: "XAUUSD", delay: "realtime" },
  silver: { id: "silver", symbol: "TVC:SILVER", ticker: "SILVER", delay: "mayDelay" },
  platinum: { id: "platinum", symbol: "TVC:PLATINUM", ticker: "PLATINUM", delay: "mayDelay" },
  oil: { id: "oil", symbol: "TVC:USOIL", ticker: "USOIL", delay: "mayDelay" },
  brent: { id: "brent", symbol: "TVC:UKOIL", ticker: "UKOIL", delay: "mayDelay" },
  natgas: { id: "natgas", symbol: "CAPITALCOM:NATURALGAS", ticker: "NATGAS", delay: "mayDelay" },
  us02y: { id: "us02y", symbol: "OANDA:USB02YUSD", ticker: "US2Y", delay: "mayDelay" },
  us10y: { id: "us10y", symbol: "OANDA:USB10YUSD", ticker: "US10Y", delay: "mayDelay" },
  us30y: { id: "us30y", symbol: "OANDA:USB30YUSD", ticker: "US30Y", delay: "mayDelay" },
  bund: { id: "bund", symbol: "OANDA:DE10YBEUR", ticker: "BUND", delay: "mayDelay" },
  gilt: { id: "gilt", symbol: "OANDA:UK10YBGBP", ticker: "GILT", delay: "mayDelay" },
};

export const isInstrumentId = (v: unknown): v is InstrumentId => typeof v === "string" && (INSTRUMENT_IDS as readonly string[]).includes(v);

/** The catalog instrument with this TradingView symbol (a click inside a widget comes back with it). */
export const instrumentBySymbol = (symbol: string | null): Instrument | undefined =>
  symbol ? Object.values(INSTRUMENTS).find((i) => i.symbol.toUpperCase() === symbol.toUpperCase()) : undefined;

/** The D-14 core, in the Pack order: DXY, S&P 500, Nasdaq, Gold, Oil, BTC. */
export const CORE_IDS: readonly InstrumentId[] = ["dxy", "spx", "ndx", "gold", "oil", "btc"];
export const CORE_INSTRUMENTS: readonly Instrument[] = CORE_IDS.map((id) => INSTRUMENTS[id]);

export type CategoryId = "forex" | "indices" | "crypto" | "commodities" | "bonds";

export interface MarketCategory {
  id: CategoryId;
  ids: readonly InstrumentId[];
  delay: DataDelay;
}

/** The five Overview categories (owner's decision 3); one is shown at a time. */
export const CATEGORIES: readonly MarketCategory[] = [
  { id: "forex", ids: ["eurusd", "gbpusd", "usdjpy", "audusd", "usdchf", "usdcad", "nzdusd"], delay: "realtime" },
  { id: "indices", ids: ["spx", "ndx", "dji", "dax", "ftse", "nikkei", "dxy"], delay: "mayDelay" },
  { id: "crypto", ids: ["btc", "eth", "sol"], delay: "realtime" },
  { id: "commodities", ids: ["gold", "silver", "platinum", "oil", "brent", "natgas"], delay: "mayDelay" },
  { id: "bonds", ids: ["us02y", "us10y", "us30y", "bund", "gilt"], delay: "mayDelay" },
];

export const symbolsOf = (ids: readonly InstrumentId[]) => ids.map((id) => INSTRUMENTS[id].symbol);

export const isCategoryId = (v: string | null): v is CategoryId => !!v && CATEGORIES.some((c) => c.id === v);

/** Chart timeframes (PR 1.3): our own buttons — the widget's toolbar, with its «Indicators» menu, is hidden. */
export const CHART_INTERVALS = ["5", "15", "60", "240", "D", "W"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];
export const isChartInterval = (v: unknown): v is ChartInterval => typeof v === "string" && (CHART_INTERVALS as readonly string[]).includes(v);
/** Owner's decision 2026-11-01: 1 hour by default, the chosen one is remembered. */
export const DEFAULT_CHART_INTERVAL: ChartInterval = "60";
export const DEFAULT_CHART_INSTRUMENT: InstrumentId = "dxy";
