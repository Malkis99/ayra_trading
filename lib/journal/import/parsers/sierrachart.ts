import { roundTripParser } from "../pipelines";

/**
 * Sierra Chart → Trade Activity Log → Trades tab export (tab-separated text).
 * Columns: Symbol, Trade Type (Long/Short), Entry DateTime, Exit DateTime, Entry Price, Exit Price,
 * Trade Quantity, Profit/Loss (C), Commission (C).
 */
export const sierraChartParser = roundTripParser({
  id: "sierrachart",
  group: "futures",
  kinds: ["csv"],
  required: [["Symbol"], ["Trade Type"], ["Entry DateTime"], ["Exit DateTime"], ["Entry Price"], ["Exit Price"]],
  signature: [["Trade Quantity"], ["Profit/Loss"], ["FlatToFlat Profit/Loss"], ["Max Open Quantity"]],
  columns: {
    instrument: ["Symbol"],
    direction: ["Trade Type"],
    openedAt: ["Entry DateTime"],
    closedAt: ["Exit DateTime"],
    entryPrice: ["Entry Price"],
    exitPrice: ["Exit Price"],
    size: ["Trade Quantity", "Max Open Quantity"],
    profit: ["Profit/Loss"],
    commission: ["Commission"],
  },
});
