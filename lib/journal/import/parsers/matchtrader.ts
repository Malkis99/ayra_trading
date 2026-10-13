import { roundTripParser } from "../pipelines";

/**
 * Match-Trader closed positions export (CSV).
 * Columns: ID, Symbol, Side, Volume, Open Time, Open Price, Close Time, Close Price, SL, TP, Commission, Swap, Profit.
 */
export const matchTraderParser = roundTripParser({
  id: "matchtrader",
  group: "forex",
  kinds: ["csv"],
  required: [["Symbol"], ["Side"], ["Open Time"], ["Open Price"], ["Close Time"], ["Close Price"], ["Profit"]],
  signature: [["ID"], ["Volume"], ["SL"], ["TP"], ["Swap"]],
  columns: {
    externalId: ["ID", "Position ID"],
    instrument: ["Symbol"],
    direction: ["Side"],
    size: ["Volume"],
    openedAt: ["Open Time"],
    entryPrice: ["Open Price"],
    closedAt: ["Close Time"],
    exitPrice: ["Close Price"],
    stopLoss: ["SL", "Stop Loss"],
    takeProfit: ["TP", "Take Profit"],
    commission: ["Commission"],
    swap: ["Swap"],
    profit: ["Profit"],
  },
});
