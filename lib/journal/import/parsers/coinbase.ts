import { fillsParser } from "../pipelines";

/**
 * Coinbase → Statements → Transaction history (CSV, with a few title lines before the header).
 * Columns: Timestamp, Transaction Type (Buy, Sell, Advanced Trade Buy…), Asset, Quantity Transacted,
 * Spot Price Currency, Spot Price at Transaction, Subtotal, Total (inclusive of fees and/or spread), Fees and/or Spread.
 * Sends, receives, rewards and conversions are not trades and are skipped.
 */
export const coinbaseParser = fillsParser({
  id: "coinbase",
  group: "crypto",
  kinds: ["csv"],
  required: [["Timestamp"], ["Transaction Type"], ["Asset"], ["Quantity Transacted"], ["Spot Price at Transaction", "Price at Transaction"]],
  signature: [["Spot Price Currency"], ["Subtotal"], ["Fees and/or Spread", "Fees"]],
  columns: {
    time: ["Timestamp"],
    instrument: ["Asset"],
    side: ["Transaction Type"],
    qty: ["Quantity Transacted"],
    price: ["Spot Price at Transaction", "Price at Transaction"],
    fee: ["Fees and/or Spread", "Fees"],
    id: ["ID"],
  },
  computeProfit: true,
  skipRow: (row, cols) => !/\b(buy|sell)\b/i.test(row[cols.side] ?? ""),
});
