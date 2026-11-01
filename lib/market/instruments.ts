/**
 * Market Overview instruments (PR 1.2, `docs/market-plan.md` sections 8–9): the D-14 core and the five categories
 * (owner's decision 3), shown with free TradingView widgets.
 *
 * Every symbol was checked in the widgets (2026-11-01): exchange feeds such as `TVC:DXY`, `SP:SPX`, `NASDAQ:NDX` and
 * the yields `TVC:US10Y` are "only available on TradingView" there, so the widget-friendly feeds below are used.
 * Bond yields are not available in the widgets at all: the bonds category shows bond prices (a price up = a yield
 * down), and says so.
 */

/** How fresh the data is, as far as it is known for the feed: forex and crypto feeds are real-time, CFD feeds of
 * indices, commodities and bonds may be delayed (the widgets do not say by how much). */
export type DataDelay = "realtime" | "mayDelay";

export type CoreId = "dxy" | "spx" | "ndx" | "gold" | "oil" | "btc";

export interface CoreInstrument {
  id: CoreId;
  symbol: string;
  delay: DataDelay;
}

/** The D-14 core, in the Pack order: DXY, S&P 500, Nasdaq, Gold, Oil, BTC. */
export const CORE_INSTRUMENTS: readonly CoreInstrument[] = [
  { id: "dxy", symbol: "CAPITALCOM:DXY", delay: "mayDelay" },
  { id: "spx", symbol: "FOREXCOM:SPXUSD", delay: "mayDelay" },
  { id: "ndx", symbol: "FOREXCOM:NSXUSD", delay: "mayDelay" },
  { id: "gold", symbol: "OANDA:XAUUSD", delay: "realtime" },
  { id: "oil", symbol: "TVC:USOIL", delay: "mayDelay" },
  { id: "btc", symbol: "BITSTAMP:BTCUSD", delay: "realtime" },
];

export type CategoryId = "forex" | "indices" | "crypto" | "commodities" | "bonds";

export interface MarketCategory {
  id: CategoryId;
  symbols: readonly string[];
  delay: DataDelay;
}

/** The five Overview categories (owner's decision 3); one is shown at a time. */
export const CATEGORIES: readonly MarketCategory[] = [
  { id: "forex", symbols: ["FX:EURUSD", "FX:GBPUSD", "FX:USDJPY", "FX:AUDUSD", "FX:USDCHF", "FX:USDCAD", "FX:NZDUSD"], delay: "realtime" },
  {
    id: "indices",
    symbols: ["FOREXCOM:SPXUSD", "FOREXCOM:NSXUSD", "FOREXCOM:DJI", "FOREXCOM:GRXEUR", "FOREXCOM:UKXGBP", "FOREXCOM:JPXJPY", "CAPITALCOM:DXY"],
    delay: "mayDelay",
  },
  { id: "crypto", symbols: ["BITSTAMP:BTCUSD", "BITSTAMP:ETHUSD", "BINANCE:SOLUSDT"], delay: "realtime" },
  { id: "commodities", symbols: ["OANDA:XAUUSD", "TVC:SILVER", "TVC:PLATINUM", "TVC:USOIL", "TVC:UKOIL", "CAPITALCOM:NATURALGAS"], delay: "mayDelay" },
  { id: "bonds", symbols: ["OANDA:USB02YUSD", "OANDA:USB10YUSD", "OANDA:USB30YUSD", "OANDA:DE10YBEUR", "OANDA:UK10YBGBP"], delay: "mayDelay" },
];

export const isCategoryId = (v: string | null): v is CategoryId => !!v && CATEGORIES.some((c) => c.id === v);
