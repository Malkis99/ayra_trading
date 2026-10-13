import type { ImportParser } from "../types";
import { fillsParser, roundTripParser } from "../pipelines";

/**
 * Bybit exports (CSV):
 * - Derivatives → Closed P&L: Contracts, Closing Direction ("Close Long"), Qty, Entry Price, Exit Price, Closed P&L,
 *   Exit Type, Trade Time(UTC+0). One row = one closed position.
 * - Trade History (spot / derivatives fills): Symbol, Side, Exec Price / Filled Price, Exec Qty / Filled, Fee, Trade Time.
 */
const closedPnl = roundTripParser({
  id: "bybit",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Contracts", "Symbol", "Market"], ["Closing Direction", "Trade Type"], ["Entry Price"], ["Exit Price"], ["Closed P&L", "Closed PnL"]],
  signature: [["Exit Type"], ["Trade Time"], ["Qty"]],
  columns: {
    instrument: ["Contracts", "Symbol", "Market"],
    direction: ["Closing Direction", "Trade Type"],
    size: ["Qty", "Quantity"],
    entryPrice: ["Entry Price"],
    exitPrice: ["Exit Price"],
    netProfit: ["Closed P&L", "Closed PnL"],
    openedAt: ["Trade Time", "Create Time", "Order Time"],
    externalId: ["Order ID"],
  },
});

const fills = fillsParser({
  id: "bybit",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  required: [["Symbol"], ["Side", "Direction"], ["Exec Price", "Filled Price", "Exec. Price"], ["Exec Qty", "Filled", "Exec. Qty"]],
  signature: [["Trade Time"], ["Fee", "Trading Fee"], ["Order ID"]],
  columns: {
    time: ["Trade Time", "Transaction Time", "Time"],
    instrument: ["Symbol"],
    side: ["Side", "Direction"],
    qty: ["Exec Qty", "Filled", "Exec. Qty"],
    price: ["Exec Price", "Filled Price", "Exec. Price"],
    fee: ["Fee", "Trading Fee"],
    realized: ["Closed P&L", "Realized P&L"],
    id: ["Exec ID", "Trade ID", "Order ID"],
  },
  computeProfit: true,
});

export const bybitParser: ImportParser = {
  id: "bybit",
  group: "crypto",
  kinds: ["csv", "xlsx"],
  verification: "documented",
  detect: (t) => Math.max(closedPnl.detect(t), fills.detect(t)),
  parse: (t, o) => (closedPnl.detect(t) >= fills.detect(t) ? closedPnl.parse(t, o) : fills.parse(t, o)),
};
