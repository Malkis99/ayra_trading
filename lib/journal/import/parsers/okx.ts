import { fillsParser } from "../pipelines";

/**
 * OKX → Assets → Order center → Trade history → Download (CSV).
 * Columns: Trade time, Instrument, Side, Fill price, Fill quantity / Filled, Fee, PnL, Order ID, Trade ID.
 */
export const okxParser = fillsParser({
  id: "okx",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Instrument", "Symbol"], ["Side"], ["Fill price", "Filled price", "Price"], ["Fill quantity", "Filled", "Fill amount"], ["Trade time", "Time", "Fill time"]],
  signature: [["Trade ID"], ["PnL"], ["Fee"]],
  columns: {
    time: ["Trade time", "Fill time", "Time"],
    instrument: ["Instrument", "Symbol"],
    side: ["Side"],
    qty: ["Fill quantity", "Filled", "Fill amount"],
    price: ["Fill price", "Filled price", "Price"],
    fee: ["Fee"],
    realized: ["PnL", "Realized PnL"],
    id: ["Trade ID", "Order ID"],
  },
  computeProfit: true,
});
