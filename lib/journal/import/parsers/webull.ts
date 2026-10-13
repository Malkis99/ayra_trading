import { fillsParser } from "../pipelines";

/**
 * Webull → Orders → Export (CSV).
 * Columns: Name, Symbol, Side (Buy/Sell/Short), Status, Filled, Total Qty, Price, Avg Price, Time-in-Force,
 * Placed Time, Filled Time ("01/15/2024 10:30:00 EST"). Only filled orders are fills.
 */
export const webullParser = fillsParser({
  id: "webull",
  group: "stocks",
  kinds: ["csv"],
  required: [["Symbol"], ["Side"], ["Status"], ["Filled"], ["Avg Price"]],
  signature: [["Total Qty"], ["Placed Time"], ["Filled Time"], ["Time-in-Force"]],
  columns: {
    time: ["Filled Time", "Placed Time"],
    instrument: ["Symbol"],
    side: ["Side"],
    qty: ["Filled"],
    price: ["Avg Price"],
    status: ["Status"],
  },
  statusFilled: /^filled/i,
  computeProfit: true,
});
