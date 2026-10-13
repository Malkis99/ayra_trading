import type { ImportFormatId, ImportParser, RawTable } from "./types";
import { ayraParser } from "./parsers/ayra";
import { mt4Parser } from "./parsers/mt4";
import { mt5Parser } from "./parsers/mt5";
import { ctraderParser } from "./parsers/ctrader";
import { matchTraderParser } from "./parsers/matchtrader";
import { dxtradeParser } from "./parsers/dxtrade";
import { tradeLockerParser } from "./parsers/tradelocker";
import { tradingViewParser } from "./parsers/tradingview";
import { ninjaTraderParser } from "./parsers/ninjatrader";
import { tradovateParser } from "./parsers/tradovate";
import { rithmicParser } from "./parsers/rithmic";
import { sierraChartParser } from "./parsers/sierrachart";
import { ibkrParser } from "./parsers/ibkr";
import { thinkorswimParser } from "./parsers/thinkorswim";
import { tastytradeParser } from "./parsers/tastytrade";
import { webullParser } from "./parsers/webull";
import { binanceParser } from "./parsers/binance";
import { bybitParser } from "./parsers/bybit";
import { okxParser } from "./parsers/okx";
import { kucoinParser } from "./parsers/kucoin";
import { bitgetParser } from "./parsers/bitget";
import { mexcParser } from "./parsers/mexc";
import { bingxParser } from "./parsers/bingx";
import { gateioParser } from "./parsers/gateio";
import { krakenParser } from "./parsers/kraken";
import { coinbaseParser } from "./parsers/coinbase";
import { universalParser } from "./parsers/universal";

/** Every supported source, in the order shown to the user. */
export const IMPORT_PARSERS: ImportParser[] = [
  mt4Parser,
  mt5Parser,
  ctraderParser,
  matchTraderParser,
  dxtradeParser,
  tradeLockerParser,
  tradingViewParser,
  ninjaTraderParser,
  tradovateParser,
  rithmicParser,
  sierraChartParser,
  ibkrParser,
  thinkorswimParser,
  tastytradeParser,
  webullParser,
  binanceParser,
  bybitParser,
  okxParser,
  kucoinParser,
  bitgetParser,
  mexcParser,
  bingxParser,
  gateioParser,
  krakenParser,
  coinbaseParser,
  universalParser,
  ayraParser,
];

/** Display names of platforms (brand names, not translated). */
export const PLATFORM_NAMES: Record<ImportFormatId, string> = {
  mt4: "MetaTrader 4",
  mt5: "MetaTrader 5",
  ctrader: "cTrader",
  matchtrader: "Match-Trader",
  dxtrade: "DXtrade",
  tradelocker: "TradeLocker",
  tradingview: "TradingView",
  ninjatrader: "NinjaTrader",
  tradovate: "Tradovate",
  rithmic: "Rithmic",
  sierrachart: "Sierra Chart",
  ibkr: "Interactive Brokers",
  thinkorswim: "thinkorswim",
  tastytrade: "tastytrade",
  webull: "Webull",
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
  kucoin: "KuCoin",
  bitget: "Bitget",
  mexc: "MEXC",
  bingx: "BingX",
  gateio: "Gate.io",
  kraken: "Kraken",
  coinbase: "Coinbase",
  universal: "CSV / XLSX",
  ayra: "AYRA JSON",
};

export function getParser(id: ImportFormatId): ImportParser {
  return IMPORT_PARSERS.find((p) => p.id === id) ?? universalParser;
}

export interface Detection {
  parser: ImportParser;
  table: RawTable;
  score: number;
}

/** Picks the most likely format and table (sheet) for a file; falls back to the universal mapping. */
export function detectFormat(tables: RawTable[]): Detection | null {
  let best: Detection | null = null;
  for (const table of tables) {
    for (const parser of IMPORT_PARSERS) {
      if (parser.id === "universal") continue;
      const score = parser.detect(table);
      if (score > (best?.score ?? 0)) best = { parser, table, score };
    }
  }
  if (best && best.score >= 0.6) return best;
  const table = tables.find((t) => t.kind !== "json" && t.rows.length > 1) ?? null;
  return table ? { parser: universalParser, table, score: 0 } : null;
}

/** Table of a file that suits a parser the user picked manually (best scoring sheet/table). */
export function tableFor(parser: ImportParser, tables: RawTable[]): RawTable | null {
  let best: RawTable | null = null;
  let bestScore = -1;
  for (const t of tables) {
    if (!parser.kinds.includes(t.kind)) continue;
    const s = parser.detect(t);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best;
}
