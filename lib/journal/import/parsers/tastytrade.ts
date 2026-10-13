import { fillsParser } from "../pipelines";

/**
 * tastytrade → History → Transactions → CSV.
 * Columns: Date, Type, Sub Type, Action (BUY_TO_OPEN, SELL_TO_CLOSE…), Symbol, Instrument Type, Description,
 * Value, Quantity, Average Price, Commissions, Fees, Multiplier, Root Symbol, Order #. Only "Trade" rows are fills.
 */
export const tastytradeParser = fillsParser({
  id: "tastytrade",
  group: "stocks",
  kinds: ["csv"],
  required: [["Date"], ["Type"], ["Action"], ["Symbol"], ["Quantity"], ["Average Price"]],
  signature: [["Instrument Type"], ["Commissions"], ["Multiplier"], ["Order #"]],
  columns: {
    time: ["Date"],
    instrument: ["Symbol"],
    side: ["Action"],
    qty: ["Quantity"],
    price: ["Average Price"],
    fee: ["Commissions"],
    id: ["Order #"],
    status: ["Type"],
  },
  statusFilled: /^trade$/i,
  computeProfit: true,
});
