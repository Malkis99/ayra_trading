import { fillsParser } from "../pipelines";

/**
 * MEXC → Orders → Trade history → Export (CSV). Columns: Pair, Time, Side, Filled Price, Executed Amount, Total,
 * Fee, Role. Futures exports add "Closing PNL".
 */
export const mexcParser = fillsParser({
  id: "mexc",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Pair", "Symbol"], ["Time"], ["Side"], ["Filled Price"], ["Executed Amount", "Filled Quantity"]],
  signature: [["Role"], ["Total"], ["Fee"]],
  columns: {
    time: ["Time"],
    instrument: ["Pair", "Symbol"],
    side: ["Side"],
    qty: ["Executed Amount", "Filled Quantity"],
    price: ["Filled Price"],
    fee: ["Fee"],
    realized: ["Closing PNL", "Realized PNL"],
  },
  computeProfit: true,
});
