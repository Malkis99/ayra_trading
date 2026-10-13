import type { ImportParser, ParseResult, RawTable } from "../types";
import { fillsParser, roundTripParser } from "../pipelines";
import { findColumn, findHeaderRow } from "../util";

/**
 * MetaTrader 5 trade history report (HTML or XLSX "ReportHistory", or CSV).
 * The report has sections: Positions (one row per closed position), Orders, Deals.
 * Positions: Time, Position, Symbol, Type, Volume, Price, S / L, T / P, Time, Price, Commission, Swap, Profit.
 * Deals: Time, Deal, Symbol, Type, Direction (in/out), Volume, Price, Order, Commission, Fee, Swap, Profit, Balance, Comment.
 * Positions are used when present; otherwise deals are paired in/out.
 */
const positions = roundTripParser({
  id: "mt5",
  group: "forex",
  kinds: ["html", "xlsx", "csv"],
  required: [["Position"], ["Symbol"], ["Type"], ["Volume"], ["Profit"], ["Time"]],
  signature: [["S / L", "S/L"], ["T / P", "T/P"], ["Swap"], ["Commission"]],
  columns: {
    externalId: ["Position"],
    instrument: ["Symbol"],
    direction: ["Type"],
    size: ["Volume"],
    stopLoss: ["S / L", "S/L"],
    takeProfit: ["T / P", "T/P"],
    commission: ["Commission"],
    swap: ["Swap"],
    profit: ["Profit"],
    openedAt: ["Time", "Open Time"],
  },
  repeated: {
    openedAt: { alias: "Time", occurrence: 1 },
    closedAt: { alias: "Time", occurrence: 2 },
    entryPrice: { alias: "Price", occurrence: 1 },
    exitPrice: { alias: "Price", occurrence: 2 },
  },
  stopAt: /^(orders|deals|open positions|working orders|summary|results)$/i,
});

const deals = fillsParser({
  id: "mt5",
  group: "forex",
  kinds: ["html", "xlsx", "csv"],
  required: [["Deal"], ["Symbol"], ["Type"], ["Direction"], ["Volume"], ["Price"]],
  columns: {
    time: ["Time"],
    id: ["Deal"],
    instrument: ["Symbol"],
    side: ["Type"],
    effect: ["Direction"],
    qty: ["Volume"],
    price: ["Price"],
    fee: ["Commission"],
    realized: ["Profit"],
  },
  computeProfit: false,
  skipRow: (row, cols) => /balance|credit|deposit|withdraw/i.test(row[cols.side] ?? ""),
});

/** Restrict a table to the rows after the header row that matches `required` (the report has several sections). */
function section(table: RawTable, required: string[][]): RawTable | null {
  const h = findHeaderRow(table.rows, required, table.rows.length);
  return h < 0 ? null : { ...table, rows: table.rows.slice(h) };
}

export const mt5Parser: ImportParser = {
  id: "mt5",
  group: "forex",
  kinds: ["html", "xlsx", "csv"],
  verification: "documented",
  detect(table) {
    const pos = section(table, [["Position"], ["Symbol"], ["Volume"], ["Profit"]]);
    const deal = section(table, [["Deal"], ["Direction"], ["Symbol"], ["Volume"]]);
    if (pos) return Math.max(positions.detect(pos), 0.9);
    if (deal) return Math.max(deals.detect(deal), 0.85);
    return 0;
  },
  parse(table, opts): ParseResult {
    const pos = section(table, [["Position"], ["Symbol"], ["Volume"], ["Profit"]]);
    if (pos && findColumn(pos.rows[0], ["S / L", "S/L"]) >= 0) return positions.parse(pos, opts);
    const deal = section(table, [["Deal"], ["Direction"], ["Symbol"], ["Volume"]]);
    if (deal) return deals.parse(deal, opts);
    return { trades: [], errors: [] };
  },
};
