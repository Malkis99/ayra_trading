import { roundTripParser } from "../pipelines";

/**
 * TradeLocker positions history (CSV).
 * Columns: Position ID, Instrument, Side, Amount / Qty, Open Time, Open Price, Close Time, Close Price,
 * Stop Loss, Take Profit, Commission, Swap, Profit / Net P&L.
 */
export const tradeLockerParser = roundTripParser({
  id: "tradelocker",
  group: "forex",
  kinds: ["csv"],
  required: [["Instrument"], ["Side"], ["Open Time"], ["Close Time"], ["Amount", "Qty", "Quantity"], ["Profit", "Net P&L", "Net PnL"]],
  signature: [["Stop Loss"], ["Take Profit"], ["Open Price"], ["Close Price"]],
  columns: {
    externalId: ["Position ID", "ID"],
    instrument: ["Instrument", "Symbol"],
    direction: ["Side"],
    size: ["Amount", "Qty", "Quantity"],
    openedAt: ["Open Time"],
    entryPrice: ["Open Price"],
    closedAt: ["Close Time"],
    exitPrice: ["Close Price"],
    stopLoss: ["Stop Loss"],
    takeProfit: ["Take Profit"],
    commission: ["Commission", "Fee"],
    swap: ["Swap"],
    profit: ["Profit"],
    netProfit: ["Net P&L", "Net PnL"],
  },
});
