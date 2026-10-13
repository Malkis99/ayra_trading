import type { ImportParser } from "../types";
import { fillsParser } from "../pipelines";

/**
 * TradingView Paper Trading → Order History export (CSV).
 * Columns: Symbol, Side, Type, Qty, Limit Price, Stop Price, Fill Price, Status, Commission, Placing Time, Closing Time, Order ID.
 * Only "Filled" orders are executions; they are paired into trades. Futures symbols ("NQ1!") get no
 * computed profit because the contract multiplier is not in the file.
 */
const base = fillsParser({
  id: "tradingview",
  group: "other",
  kinds: ["csv"],
  required: [["Symbol"], ["Side"], ["Fill Price"], ["Status"], ["Qty"]],
  signature: [["Placing Time"], ["Closing Time"], ["Order ID"], ["Limit Price"]],
  columns: {
    time: ["Closing Time", "Fill Time", "Placing Time", "Time"],
    instrument: ["Symbol"],
    side: ["Side"],
    qty: ["Qty", "Quantity"],
    price: ["Fill Price", "Avg Fill Price"],
    fee: ["Commission"],
    status: ["Status"],
    id: ["Order ID"],
  },
  statusFilled: /^fill/i,
  computeProfit: true,
});

export const tradingViewParser: ImportParser = {
  ...base,
  parse(table, opts) {
    const res = base.parse(table, opts);
    for (const t of res.trades) {
      // "CME_MINI:NQ1!" → "NQ1!" ; futures: no multiplier → leave profit empty
      t.instrument = t.instrument.includes(":") ? t.instrument.split(":").pop()! : t.instrument;
      if (t.instrument.endsWith("!")) t.profit = undefined;
    }
    return res;
  },
};
