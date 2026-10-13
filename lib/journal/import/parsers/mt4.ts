import { roundTripParser } from "../pipelines";
import { parseSide } from "../util";

/**
 * MetaTrader 4 account statement / history report (HTML "Closed Transactions", or the same table saved as CSV).
 * Columns: Ticket, Open Time, Type, Size, Item, Price, S/L, T/P, Close Time, Price, Commission, Taxes, Swap, Profit.
 * "balance"/"credit" rows and pending orders ("buy limit" without close) are skipped.
 */
export const mt4Parser = roundTripParser({
  id: "mt4",
  group: "forex",
  kinds: ["html", "csv"],
  required: [["Ticket"], ["Open Time"], ["Type"], ["Item", "Symbol"], ["Close Time"], ["Profit"]],
  signature: [["Size", "Lots"], ["S/L", "S / L"], ["T/P", "T / P"], ["Swap"]],
  columns: {
    externalId: ["Ticket"],
    openedAt: ["Open Time"],
    closedAt: ["Close Time"],
    direction: ["Type"],
    size: ["Size", "Lots", "Volume"],
    instrument: ["Item", "Symbol"],
    stopLoss: ["S/L", "S / L"],
    takeProfit: ["T/P", "T / P"],
    commission: ["Commission"],
    swap: ["Swap"],
    profit: ["Profit"],
  },
  repeated: { entryPrice: { alias: "Price", occurrence: 1 }, exitPrice: { alias: "Price", occurrence: 2 } },
  skipRow: (row, cols) => {
    const type = (row[cols.direction] ?? "").toLowerCase();
    if (/balance|credit|deposit|withdraw/.test(type)) return true;
    // pending orders that never became positions
    if (/limit|stop/.test(type) && !row[cols.closedAt]) return true;
    return !parseSide(type).direction && !row[cols.instrument];
  },
  stopAt: /^(open trades|working orders|summary|closed p\/l|deposit\/withdrawal)/i,
});
