import { fillsParser } from "../pipelines";

/**
 * BingX → Orders → Perpetual / Spot history → Export (CSV).
 * Columns: Time, Pair / Symbol, Type ("Open Long", "Close Long", "Buy", "Sell"), Price / Avg. Price, Quantity, Fee, Realized PnL.
 */
export const bingxParser = fillsParser({
  id: "bingx",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Time"], ["Pair", "Symbol"], ["Type", "Direction"], ["Avg. Price", "Price"], ["Quantity", "Amount"], ["Realized PnL", "Profit"]],
  signature: [["Fee"], ["Order ID"]],
  columns: {
    time: ["Time"],
    instrument: ["Pair", "Symbol"],
    side: ["Type", "Direction"],
    qty: ["Quantity", "Amount"],
    price: ["Avg. Price", "Price"],
    fee: ["Fee"],
    realized: ["Realized PnL", "Profit"],
    id: ["Order ID"],
  },
  computeProfit: true,
});
