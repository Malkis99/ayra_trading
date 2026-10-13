import type { ImportParser } from "../types";
import { fillsParser, roundTripParser } from "../pipelines";

/**
 * NinjaTrader 8 exports (CSV):
 * - Trade Performance → Trades grid: Trade number, Instrument, Account, Strategy, Market pos., Qty, Entry price,
 *   Exit price, Entry time, Exit time, Profit, Cum. net profit, Commission.
 * - Executions grid: Instrument, Action, Quantity, Price, Time, ID, E/X, Position, Order ID, Name, Commission, Account.
 */
const trades = roundTripParser({
  id: "ninjatrader",
  group: "futures",
  kinds: ["csv"],
  required: [["Instrument"], ["Market pos.", "Market position"], ["Entry price"], ["Exit price"], ["Entry time"], ["Exit time"]],
  signature: [["Trade number"], ["Cum. net profit"], ["MAE"], ["MFE"]],
  columns: {
    externalId: ["Trade number"],
    instrument: ["Instrument"],
    direction: ["Market pos.", "Market position"],
    size: ["Qty", "Quantity"],
    entryPrice: ["Entry price"],
    exitPrice: ["Exit price"],
    openedAt: ["Entry time"],
    closedAt: ["Exit time"],
    profit: ["Profit"],
    commission: ["Commission"],
  },
});

const executions = fillsParser({
  id: "ninjatrader",
  group: "futures",
  kinds: ["csv"],
  required: [["Instrument"], ["Action"], ["Quantity"], ["Price"], ["Time"], ["E/X"]],
  signature: [["Order ID"], ["Position"], ["Connection"]],
  columns: {
    time: ["Time"],
    instrument: ["Instrument"],
    side: ["Action"],
    qty: ["Quantity"],
    price: ["Price"],
    fee: ["Commission"],
    effect: ["E/X"],
    id: ["ID", "Execution ID"],
  },
  computeProfit: false,
});

export const ninjaTraderParser: ImportParser = {
  id: "ninjatrader",
  group: "futures",
  kinds: ["csv"],
  verification: "documented",
  detect: (t) => Math.max(trades.detect(t), executions.detect(t)),
  parse: (t, o) => (trades.detect(t) >= executions.detect(t) ? trades.parse(t, o) : executions.parse(t, o)),
};
