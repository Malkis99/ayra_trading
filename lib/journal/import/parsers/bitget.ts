import { fillsParser } from "../pipelines";

/**
 * Bitget → Orders → Futures / Spot order history → Export (CSV).
 * Columns: Date, Futures / Trading pair, Direction ("Open Long", "Close Short", "Buy", "Sell"), Average Price,
 * Executed, Trading Fee, Realized P/L, Order ID.
 */
export const bitgetParser = fillsParser({
  id: "bitget",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Date", "Time"], ["Futures", "Trading pair", "Symbol"], ["Direction"], ["Average Price", "Avg. Price", "Price"], ["Executed", "Filled"]],
  signature: [["Trading Fee"], ["Realized P/L", "Realized PnL"], ["Order ID"]],
  columns: {
    time: ["Date", "Time"],
    instrument: ["Futures", "Trading pair", "Symbol"],
    side: ["Direction"],
    qty: ["Executed", "Filled"],
    price: ["Average Price", "Avg. Price", "Price"],
    fee: ["Trading Fee", "Fee"],
    realized: ["Realized P/L", "Realized PnL"],
    id: ["Order ID"],
  },
  computeProfit: true,
});
