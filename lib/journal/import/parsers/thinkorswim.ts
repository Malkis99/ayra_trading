import { fillsParser } from "../pipelines";

/**
 * thinkorswim → Monitor → Account Statement → Export (CSV with sections). The "Account Trade History"
 * section: Exec Time, Spread, Side, Qty (signed), Pos Effect (TO OPEN / TO CLOSE), Symbol, Exp, Strike, Type, Price, Net Price.
 * Note: for options the profit is computed without the ×100 multiplier — check the result.
 */
export const thinkorswimParser = fillsParser({
  id: "thinkorswim",
  group: "stocks",
  kinds: ["csv"],
  required: [["Exec Time"], ["Side"], ["Qty"], ["Pos Effect"], ["Symbol"], ["Price"]],
  signature: [["Spread"], ["Net Price"], ["Order Type"], ["Strike"]],
  columns: {
    time: ["Exec Time"],
    instrument: ["Symbol"],
    side: ["Side"],
    qty: ["Qty"],
    price: ["Price"],
    effect: ["Pos Effect"],
  },
  signedQty: true,
  computeProfit: true,
});
