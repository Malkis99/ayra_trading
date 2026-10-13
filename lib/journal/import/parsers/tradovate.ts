import type { ImportParser, NormalizedTrade, RowError } from "../types";
import { cleanInstrument, findColumn, findHeaderRow, headerScore, isBlankRow, parseDateTime, parseNumber } from "../util";

/**
 * Tradovate → Reports → Performance (CSV). One row = one closed round trip:
 * symbol, _priceFormat, _tickSize, buyFillId, sellFillId, qty, buyPrice, sellPrice, pnl, boughtTimestamp, soldTimestamp, duration.
 * Direction: long when the buy happened first, short when the sell happened first. pnl looks like "$(12.50)".
 */
const REQUIRED = [["symbol"], ["qty"], ["buyPrice"], ["sellPrice"], ["pnl"], ["boughtTimestamp"], ["soldTimestamp"]];

export const tradovateParser: ImportParser = {
  id: "tradovate",
  group: "futures",
  kinds: ["csv"],
  verification: "documented",
  detect: (t) => (t.kind === "csv" ? headerScore(t.rows, REQUIRED, [["buyFillId"], ["sellFillId"], ["_tickSize"]]) : 0),
  parse(table, opts) {
    const h = findHeaderRow(table.rows, REQUIRED);
    const trades: NormalizedTrade[] = [];
    const errors: RowError[] = [];
    if (h < 0) return { trades, errors };
    const head = table.rows[h];
    const c = (a: string) => findColumn(head, [a]);
    const col = { symbol: c("symbol"), qty: c("qty"), buy: c("buyPrice"), sell: c("sellPrice"), pnl: c("pnl"), bt: c("boughtTimestamp"), st: c("soldTimestamp"), bid: c("buyFillId"), sid: c("sellFillId") };
    table.rows.slice(h + 1).forEach((row, i) => {
      const n = h + 2 + i;
      if (isBlankRow(row)) return;
      const bought = parseDateTime(row[col.bt], { timeZone: opts.timeZone });
      const sold = parseDateTime(row[col.st], { timeZone: opts.timeZone });
      const instrument = cleanInstrument(row[col.symbol]);
      if (!instrument) return errors.push({ row: n, code: "missingInstrument" });
      if (!bought || !sold) return errors.push({ row: n, code: "badTime", field: head[!bought ? col.bt : col.st] });
      const long = bought <= sold;
      trades.push({
        externalId: [row[col.bid], row[col.sid]].filter(Boolean).join("-") || undefined,
        instrument,
        direction: long ? "long" : "short",
        openedAt: long ? bought : sold,
        closedAt: long ? sold : bought,
        entryPrice: parseNumber(long ? row[col.buy] : row[col.sell]),
        exitPrice: parseNumber(long ? row[col.sell] : row[col.buy]),
        size: Math.abs(parseNumber(row[col.qty]) ?? 0) || undefined,
        profit: parseNumber(row[col.pnl]),
        rows: [n],
      });
    });
    return { trades, errors };
  },
};
