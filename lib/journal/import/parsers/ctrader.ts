import { roundTripParser } from "../pipelines";

/**
 * cTrader History export (CSV, XLSX). Times carry the zone in the header: "Opening time (UTC+3)".
 * Columns: Position ID / ID, Symbol, Opening direction, Opening time, Closing time, Entry price,
 * Closing price, Closing Quantity / Quantity, Gross $ / Net $, Commissions, Swap.
 */
export const ctraderParser = roundTripParser({
  id: "ctrader",
  group: "forex",
  kinds: ["csv", "xlsx"],
  required: [["Symbol"], ["Opening direction", "Direction"], ["Opening time", "Open time"], ["Closing time", "Close time"]],
  signature: [["Entry price"], ["Closing price"], ["Net", "Net USD", "Net EUR"], ["Pips"]],
  columns: {
    externalId: ["Position ID", "ID", "Position"],
    instrument: ["Symbol"],
    direction: ["Opening direction", "Direction"],
    openedAt: ["Opening time", "Open time"],
    closedAt: ["Closing time", "Close time"],
    entryPrice: ["Entry price", "Opening price"],
    exitPrice: ["Closing price", "Close price"],
    size: ["Closing Quantity", "Quantity", "Volume", "Lots"],
    profit: ["Gross", "Gross USD", "Gross EUR", "Gross $", "Gross €"],
    netProfit: ["Net", "Net USD", "Net EUR", "Net $", "Net €", "Net profit"],
    commission: ["Commissions", "Commission"],
    swap: ["Swap"],
    stopLoss: ["Stop loss", "SL"],
    takeProfit: ["Take profit", "TP"],
  },
});
