/**
 * The Market catalog (PR 1.2, 1.3, «Instruments»; `docs/market-plan.md` sections 8–9). The Chart and the Watchlist
 * pick only from here (owner's decision 2026-11-01: no free tickers); the Overview shows a short list per category.
 *
 * Every symbol was opened in the TradingView widgets (2026-11-01). Exchange feeds such as `TVC:DXY`, `SP:SPX`,
 * `NASDAQ:NDX`, `TVC:VIX`, `CBOE:VIX`, `TVC:HSI` and the yields `TVC:US10Y` are "only available on TradingView" there,
 * so the widget-friendly feeds below are used. Bond yields are not available in the widgets at all: the bonds show
 * prices (a price up = a yield down), and say so. TON does not open on any exchange tried (see the PR).
 */

/**
 * How fresh the data is, as far as it is known: forex and crypto feeds are real-time; CFD feeds of indices,
 * commodities and bonds may be delayed (the widgets do not say by how much); US stocks are marked «D» (delayed) by
 * the widgets themselves.
 */
export type DataDelay = "realtime" | "mayDelay" | "delayed";

export type CategoryId = "forex" | "indices" | "crypto" | "commodities" | "bonds" | "stocks";

export interface Instrument {
  id: string;
  /** TradingView symbol, checked in the widgets. */
  symbol: string;
  /** Short ticker shown next to the name. */
  ticker: string;
  delay: DataDelay;
  /** A name that is the same in every language (pairs, coins, companies); translated names live in the dictionary. */
  label?: string;
}

const FOREX_PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF",
  "EURGBP", "EURJPY", "EURAUD", "EURNZD", "EURCAD", "EURCHF",
  "GBPJPY", "GBPAUD", "GBPNZD", "GBPCAD", "GBPCHF",
  "AUDJPY", "AUDNZD", "AUDCAD", "AUDCHF",
  "NZDJPY", "NZDCAD", "NZDCHF",
  "CADJPY", "CADCHF", "CHFJPY",
] as const;

const forex = <P extends string>(pair: P) => ({ id: pair.toLowerCase() as Lowercase<P>, symbol: `FX:${pair}`, ticker: pair, delay: "realtime" as DataDelay, label: `${pair.slice(0, 3)}/${pair.slice(3)}` });
const coin = <I extends string>(id: I, symbol: string, ticker: string, label: string) => ({ id, symbol, ticker, delay: "realtime" as DataDelay, label });
const stock = <I extends string>(id: I, symbol: string, label: string) => ({ id, symbol, ticker: symbol.split(":")[1], delay: "delayed" as DataDelay, label });

const LIST = [
  // indices (CFD feeds)
  { id: "spx", symbol: "FOREXCOM:SPXUSD", ticker: "SPX500", delay: "mayDelay" },
  { id: "ndx", symbol: "FOREXCOM:NSXUSD", ticker: "NAS100", delay: "mayDelay" },
  { id: "dji", symbol: "FOREXCOM:DJI", ticker: "US30", delay: "mayDelay" },
  { id: "dax", symbol: "FOREXCOM:GRXEUR", ticker: "GER40", delay: "mayDelay" },
  { id: "ftse", symbol: "FOREXCOM:UKXGBP", ticker: "UK100", delay: "mayDelay" },
  { id: "nikkei", symbol: "FOREXCOM:JPXJPY", ticker: "JP225", delay: "mayDelay" },
  { id: "hk50", symbol: "FOREXCOM:HKXHKD", ticker: "HK50", delay: "mayDelay" },
  { id: "dxy", symbol: "CAPITALCOM:DXY", ticker: "DXY", delay: "mayDelay" },
  { id: "vix", symbol: "CAPITALCOM:VIX", ticker: "VIX", delay: "mayDelay" },
  // forex: all majors and crosses of EUR, GBP, JPY, AUD, NZD, CAD, CHF and USD
  ...FOREX_PAIRS.map(forex),
  // crypto, top 20 by size without stablecoins (TON does not open in the widgets)
  coin("btc", "BITSTAMP:BTCUSD", "BTCUSD", "Bitcoin (BTC)"),
  coin("eth", "BITSTAMP:ETHUSD", "ETHUSD", "Ethereum (ETH)"),
  coin("xrp", "BINANCE:XRPUSDT", "XRPUSDT", "XRP"),
  coin("bnb", "BINANCE:BNBUSDT", "BNBUSDT", "BNB"),
  coin("sol", "BINANCE:SOLUSDT", "SOLUSDT", "Solana (SOL)"),
  coin("doge", "BINANCE:DOGEUSDT", "DOGEUSDT", "Dogecoin (DOGE)"),
  coin("ada", "BINANCE:ADAUSDT", "ADAUSDT", "Cardano (ADA)"),
  coin("trx", "BINANCE:TRXUSDT", "TRXUSDT", "TRON (TRX)"),
  coin("link", "BINANCE:LINKUSDT", "LINKUSDT", "Chainlink (LINK)"),
  coin("avax", "BINANCE:AVAXUSDT", "AVAXUSDT", "Avalanche (AVAX)"),
  coin("shib", "BINANCE:SHIBUSDT", "SHIBUSDT", "Shiba Inu (SHIB)"),
  coin("dot", "BINANCE:DOTUSDT", "DOTUSDT", "Polkadot (DOT)"),
  coin("ltc", "BINANCE:LTCUSDT", "LTCUSDT", "Litecoin (LTC)"),
  coin("bch", "BINANCE:BCHUSDT", "BCHUSDT", "Bitcoin Cash (BCH)"),
  coin("xlm", "BINANCE:XLMUSDT", "XLMUSDT", "Stellar (XLM)"),
  coin("sui", "BINANCE:SUIUSDT", "SUIUSDT", "Sui (SUI)"),
  coin("hbar", "BINANCE:HBARUSDT", "HBARUSDT", "Hedera (HBAR)"),
  coin("uni", "BINANCE:UNIUSDT", "UNIUSDT", "Uniswap (UNI)"),
  coin("near", "BINANCE:NEARUSDT", "NEARUSDT", "NEAR Protocol (NEAR)"),
  // metals and energy
  { id: "gold", symbol: "OANDA:XAUUSD", ticker: "XAUUSD", delay: "realtime" },
  { id: "silver", symbol: "OANDA:XAGUSD", ticker: "XAGUSD", delay: "realtime" },
  { id: "platinum", symbol: "OANDA:XPTUSD", ticker: "XPTUSD", delay: "realtime" },
  { id: "oil", symbol: "TVC:USOIL", ticker: "USOIL", delay: "mayDelay" },
  { id: "brent", symbol: "TVC:UKOIL", ticker: "UKOIL", delay: "mayDelay" },
  { id: "natgas", symbol: "CAPITALCOM:NATURALGAS", ticker: "NATGAS", delay: "mayDelay" },
  // bonds: prices, not yields (yields do not open in the widgets)
  { id: "us02y", symbol: "OANDA:USB02YUSD", ticker: "US2Y", delay: "mayDelay" },
  { id: "us10y", symbol: "OANDA:USB10YUSD", ticker: "US10Y", delay: "mayDelay" },
  { id: "us30y", symbol: "OANDA:USB30YUSD", ticker: "US30Y", delay: "mayDelay" },
  { id: "bund", symbol: "OANDA:DE10YBEUR", ticker: "BUND", delay: "mayDelay" },
  { id: "gilt", symbol: "OANDA:UK10YBGBP", ticker: "GILT", delay: "mayDelay" },
  // popular US stocks (delayed in the widgets)
  stock("aapl", "NASDAQ:AAPL", "Apple"),
  stock("msft", "NASDAQ:MSFT", "Microsoft"),
  stock("nvda", "NASDAQ:NVDA", "NVIDIA"),
  stock("amzn", "NASDAQ:AMZN", "Amazon"),
  stock("googl", "NASDAQ:GOOGL", "Alphabet (Google)"),
  stock("meta", "NASDAQ:META", "Meta"),
  stock("tsla", "NASDAQ:TSLA", "Tesla"),
  stock("avgo", "NASDAQ:AVGO", "Broadcom"),
  stock("amd", "NASDAQ:AMD", "AMD"),
  stock("nflx", "NASDAQ:NFLX", "Netflix"),
  stock("intc", "NASDAQ:INTC", "Intel"),
  stock("pltr", "NASDAQ:PLTR", "Palantir"),
  stock("coin", "NASDAQ:COIN", "Coinbase"),
  stock("cost", "NASDAQ:COST", "Costco"),
  stock("wmt", "NASDAQ:WMT", "Walmart"),
  stock("jpm", "NYSE:JPM", "JPMorgan Chase"),
  stock("v", "NYSE:V", "Visa"),
  stock("ma", "NYSE:MA", "Mastercard"),
  stock("brkb", "NYSE:BRK.B", "Berkshire Hathaway"),
  stock("unh", "NYSE:UNH", "UnitedHealth"),
  stock("xom", "NYSE:XOM", "ExxonMobil"),
  stock("ba", "NYSE:BA", "Boeing"),
  stock("dis", "NYSE:DIS", "Disney"),
  stock("ko", "NYSE:KO", "Coca-Cola"),
] as const satisfies readonly Instrument[];

export type InstrumentId = (typeof LIST)[number]["id"];
export const INSTRUMENT_IDS: readonly InstrumentId[] = LIST.map((i) => i.id as InstrumentId);
export const INSTRUMENTS: Readonly<Record<InstrumentId, Instrument & { id: InstrumentId }>> = Object.fromEntries(LIST.map((i) => [i.id, i])) as Record<
  InstrumentId,
  Instrument & { id: InstrumentId }
>;

export const isInstrumentId = (v: unknown): v is InstrumentId => typeof v === "string" && Object.prototype.hasOwnProperty.call(INSTRUMENTS, v);

/** The catalog instrument with this TradingView symbol (a click inside a widget comes back with it). */
export const instrumentBySymbol = (symbol: string | null) =>
  symbol ? Object.values(INSTRUMENTS).find((i) => i.symbol.toUpperCase() === symbol.toUpperCase()) : undefined;

/** The name to show: translated when the dictionary has it, otherwise the same in every language. */
export function instrumentName(id: InstrumentId, names: Partial<Record<string, string>>): string {
  return names[id] ?? INSTRUMENTS[id].label ?? INSTRUMENTS[id].ticker;
}

/** The D-14 core, in the Pack order: DXY, S&P 500, Nasdaq, Gold, Oil, BTC. */
export const CORE_IDS: readonly InstrumentId[] = ["dxy", "spx", "ndx", "gold", "oil", "btc"];
export const CORE_INSTRUMENTS = CORE_IDS.map((id) => INSTRUMENTS[id]);

export interface MarketCategory {
  id: CategoryId;
  /** Everything of the category: the Chart and Watchlist picker. */
  ids: readonly InstrumentId[];
  /** The short table of the Overview. */
  featured: readonly InstrumentId[];
  delay: DataDelay;
}

const forexIds = FOREX_PAIRS.map((p) => p.toLowerCase() as InstrumentId);

/** The picker: the five Overview categories and US stocks. */
export const PICKER_CATEGORIES: readonly MarketCategory[] = [
  { id: "forex", ids: forexIds, featured: ["eurusd", "gbpusd", "usdjpy", "audusd", "usdchf", "usdcad", "nzdusd"], delay: "realtime" },
  { id: "indices", ids: ["spx", "ndx", "dji", "dax", "ftse", "nikkei", "hk50", "dxy", "vix"], featured: ["spx", "ndx", "dji", "dax", "ftse", "nikkei", "dxy"], delay: "mayDelay" },
  {
    id: "crypto",
    ids: ["btc", "eth", "xrp", "bnb", "sol", "doge", "ada", "trx", "link", "avax", "shib", "dot", "ltc", "bch", "xlm", "sui", "hbar", "uni", "near"],
    featured: ["btc", "eth", "xrp", "bnb", "sol", "doge"],
    delay: "realtime",
  },
  { id: "commodities", ids: ["gold", "silver", "platinum", "oil", "brent", "natgas"], featured: ["gold", "silver", "platinum", "oil", "brent", "natgas"], delay: "mayDelay" },
  { id: "bonds", ids: ["us02y", "us10y", "us30y", "bund", "gilt"], featured: ["us02y", "us10y", "us30y", "bund", "gilt"], delay: "mayDelay" },
  {
    id: "stocks",
    ids: ["aapl", "msft", "nvda", "amzn", "googl", "meta", "tsla", "avgo", "amd", "nflx", "intc", "pltr", "coin", "cost", "wmt", "jpm", "v", "ma", "brkb", "unh", "xom", "ba", "dis", "ko"],
    featured: ["aapl", "msft", "nvda", "amzn", "googl", "meta", "tsla"],
    delay: "delayed",
  },
];

/** The five Overview categories (owner's decision 3); stocks stay in the picker for now. */
export const CATEGORIES: readonly MarketCategory[] = PICKER_CATEGORIES.filter((c) => c.id !== "stocks");

export const categoryOf = (id: InstrumentId) => PICKER_CATEGORIES.find((c) => c.ids.includes(id))?.id;

export const symbolsOf = (ids: readonly InstrumentId[]) => ids.map((id) => INSTRUMENTS[id].symbol);

export const isCategoryId = (v: string | null): v is CategoryId => !!v && CATEGORIES.some((c) => c.id === v);

/** Chart timeframes (PR 1.3, 1.3b): our own buttons — the widget's top toolbar, with its «Indicators» menu, is hidden. */
export const CHART_INTERVALS = ["1", "3", "5", "15", "30", "60", "120", "240", "D", "W", "M"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];
export const isChartInterval = (v: unknown): v is ChartInterval => typeof v === "string" && (CHART_INTERVALS as readonly string[]).includes(v);
/** Owner's decision 2026-11-01: 1 hour by default, the chosen one is remembered. */
export const DEFAULT_CHART_INTERVAL: ChartInterval = "60";
/** The standard bar (owner 2026-11-01): 1m, 5m, 15m, 1h, 4h, 1D; «+» adds or removes favourites. */
export const DEFAULT_FAVORITE_INTERVALS: readonly ChartInterval[] = ["1", "5", "15", "60", "240", "D"];
export const DEFAULT_CHART_INSTRUMENT: InstrumentId = "dxy";
