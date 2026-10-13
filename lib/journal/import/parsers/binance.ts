import type { ImportParser } from "../types";
import { fillsParser } from "../pipelines";

/**
 * Binance trade history exports (CSV):
 * - USDⓈ-M / COIN-M Futures → Trade History: Date(UTC), Symbol, Side, Price, Quantity, Amount, Fee, Fee Coin, Realized Profit, Quote Asset.
 * - Spot → Trade History: Date(UTC), Pair, Side, Price, Executed ("0.01BTC"), Amount, Fee.
 */
const futures = fillsParser({
  id: "binance",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Date", "Date(UTC)", "Time"], ["Symbol"], ["Side"], ["Price"], ["Quantity"], ["Realized Profit"]],
  signature: [["Fee Coin"], ["Quote Asset"], ["Amount"]],
  columns: {
    time: ["Date(UTC)", "Date", "Time"],
    instrument: ["Symbol"],
    side: ["Side"],
    qty: ["Quantity"],
    price: ["Price"],
    fee: ["Fee"],
    realized: ["Realized Profit"],
  },
  computeProfit: true,
});

const spot = fillsParser({
  id: "binance",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Date(UTC)", "Date", "Time"], ["Pair"], ["Side"], ["Price"], ["Executed"]],
  signature: [["Amount"], ["Fee"]],
  columns: {
    time: ["Date(UTC)", "Date", "Time"],
    instrument: ["Pair"],
    side: ["Side"],
    qty: ["Executed"],
    price: ["Price"],
    fee: ["Fee"],
  },
  computeProfit: true,
});

export const binanceParser: ImportParser = {
  id: "binance",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  verification: "documented",
  detect: (t) => Math.max(futures.detect(t), spot.detect(t) * 0.95),
  parse: (t, o) => (futures.detect(t) > 0 ? futures.parse(t, o) : spot.parse(t, o)),
};
