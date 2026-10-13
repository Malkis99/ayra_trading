import { roundTripParser } from "../pipelines";

/**
 * DXtrade closed positions / account history (CSV).
 * Columns: Position ID, Instrument, Side, Quantity, Open Time, Open Price, Close Time, Close Price, Commission, Swap, P&L.
 */
export const dxtradeParser = roundTripParser({
  id: "dxtrade",
  group: "forex",
  kinds: ["csv"],
  required: [["Instrument"], ["Side"], ["Quantity"], ["Open Time"], ["Close Time"], ["P&L", "PnL", "Realized P&L", "Realized PnL"]],
  signature: [["Position ID"], ["Open Price"], ["Close Price"]],
  columns: {
    externalId: ["Position ID", "Order ID"],
    instrument: ["Instrument"],
    direction: ["Side"],
    size: ["Quantity"],
    openedAt: ["Open Time"],
    entryPrice: ["Open Price"],
    closedAt: ["Close Time"],
    exitPrice: ["Close Price"],
    commission: ["Commission"],
    swap: ["Swap", "Financing"],
    profit: ["P&L", "PnL", "Realized P&L", "Realized PnL"],
  },
});
