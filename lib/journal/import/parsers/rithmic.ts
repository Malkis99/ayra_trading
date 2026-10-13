import { fillsParser } from "../pipelines";

/**
 * Rithmic R | Trader Pro → Orders / Completed Orders export (CSV).
 * Columns: Account, Status, Buy/Sell, Qty To Fill, Qty Filled, Symbol, Exchange, Avg Fill Price,
 * Commission Fill Rate, Closed Profit/Loss, Update Time, Order Number. Only filled orders are used.
 */
export const rithmicParser = fillsParser({
  id: "rithmic",
  group: "futures",
  kinds: ["csv"],
  required: [["Buy/Sell"], ["Qty Filled"], ["Symbol"], ["Avg Fill Price"]],
  signature: [["Closed Profit/Loss"], ["Commission Fill Rate"], ["Order Number"], ["Exchange"]],
  columns: {
    time: ["Update Time", "Fill Time", "Create Time", "Time"],
    instrument: ["Symbol"],
    side: ["Buy/Sell"],
    qty: ["Qty Filled"],
    price: ["Avg Fill Price"],
    fee: ["Commission Fill Rate", "Commission"],
    realized: ["Closed Profit/Loss"],
    status: ["Status"],
    id: ["Order Number"],
  },
  statusFilled: /fill|complete/i,
  computeProfit: false,
});
