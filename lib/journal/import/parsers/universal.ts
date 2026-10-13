import type { ColumnMapping, ImportField, ImportParser, NormalizedTrade, RowError } from "../types";
import { cleanInstrument, findColumn, guessDayFirst, isBlankRow, parseDateTime, parseNumber, parseSide, timeZoneFromHeaders } from "../util";

/** Common header names per field, used to pre-fill the manual mapping. */
export const FIELD_ALIASES: Record<ImportField, string[]> = {
  instrument: ["Instrument", "Symbol", "Ticker", "Pair", "Market", "Asset", "Contract", "Инструмент", "Символ"],
  direction: ["Direction", "Side", "Type", "Action", "Position", "Buy/Sell", "Long/Short", "Направление", "Тип"],
  openedAt: ["Open Time", "Entry Time", "Opened", "Open Date", "Entry Date", "Date", "Time", "Время открытия", "Дата"],
  closedAt: ["Close Time", "Exit Time", "Closed", "Close Date", "Exit Date", "Время закрытия"],
  entryPrice: ["Entry Price", "Open Price", "Entry", "Цена входа", "Цена открытия"],
  exitPrice: ["Exit Price", "Close Price", "Exit", "Цена выхода", "Цена закрытия"],
  size: ["Size", "Volume", "Qty", "Quantity", "Lots", "Amount", "Объём", "Количество"],
  pnl: ["Profit", "P&L", "PnL", "Net P&L", "Result", "Прибыль", "Результат"],
  commission: ["Commission", "Fee", "Fees", "Комиссия"],
  swap: ["Swap", "Financing", "Своп"],
  stopLoss: ["Stop Loss", "SL", "S/L", "Стоп"],
  takeProfit: ["Take Profit", "TP", "T/P", "Тейк"],
  externalId: ["Ticket", "ID", "Trade ID", "Position ID", "Order ID", "Тикет"],
};

export const MAPPABLE_FIELDS: ImportField[] = [
  "instrument",
  "direction",
  "openedAt",
  "closedAt",
  "entryPrice",
  "exitPrice",
  "size",
  "pnl",
  "commission",
  "swap",
  "stopLoss",
  "takeProfit",
  "externalId",
];

export const REQUIRED_FIELDS: ImportField[] = ["instrument", "direction", "openedAt"];

/** Best guess of the header row: the first row with at least 3 non-numeric cells. */
export function guessHeaderRow(rows: string[][]): number {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const textCells = rows[r].filter((c) => c && !/^[-+\d.,\s%$()]+$/.test(c)).length;
    if (textCells >= 3) return r;
  }
  return 0;
}

/** Pre-fills the mapping from header names; the user can change every field. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of MAPPABLE_FIELDS) {
    const i = findColumn(headers, FIELD_ALIASES[field], used);
    if (i >= 0) {
      mapping[field] = i;
      used.add(i);
    }
  }
  return mapping;
}

export const universalParser: ImportParser = {
  id: "universal",
  group: "other",
  kinds: ["csv", "xlsx", "html"],
  verification: "verified",
  // Fallback: chosen only when nothing else matches
  detect: (t) => (t.kind === "json" ? 0 : 0.05),
  parse(table, opts) {
    const headerRow = opts.headerRow ?? guessHeaderRow(table.rows);
    const headers = table.rows[headerRow] ?? [];
    const mapping = opts.mapping ?? suggestMapping(headers);
    const detectedTimeZone = timeZoneFromHeaders(headers);
    const timeZone = detectedTimeZone ?? opts.timeZone;
    const trades: NormalizedTrade[] = [];
    const errors: RowError[] = [];
    const get = (row: string[], f: ImportField) => (mapping[f] === undefined ? undefined : row[mapping[f]!]);
    const rows = table.rows.slice(headerRow + 1);
    const dayFirst = guessDayFirst(rows.map((r) => get(r, "openedAt") ?? ""));
    rows.forEach((row, i) => {
      const n = headerRow + 2 + i;
      if (isBlankRow(row)) return;
      const instrument = cleanInstrument(get(row, "instrument"));
      const side = parseSide(get(row, "direction"));
      const openedAt = parseDateTime(get(row, "openedAt"), { timeZone, dayFirst });
      if (!instrument) return errors.push({ row: n, code: "missingInstrument", field: "instrument" });
      if (!side.direction) return errors.push({ row: n, code: "missingDirection", field: "direction" });
      if (!openedAt) return errors.push({ row: n, code: get(row, "openedAt") ? "badTime" : "missingTime", field: "openedAt" });
      const num = (f: ImportField) => parseNumber(get(row, f));
      const commission = num("commission");
      trades.push({
        externalId: get(row, "externalId") || undefined,
        instrument,
        direction: side.direction,
        openedAt,
        closedAt: parseDateTime(get(row, "closedAt"), { timeZone, dayFirst }),
        entryPrice: num("entryPrice"),
        exitPrice: num("exitPrice"),
        size: num("size") !== undefined ? Math.abs(num("size")!) : undefined,
        profit: num("pnl"),
        profitIsNet: true,
        commission: commission !== undefined ? Math.abs(commission) : undefined,
        swap: num("swap"),
        stopLoss: num("stopLoss") || undefined,
        takeProfit: num("takeProfit") || undefined,
        rows: [n],
      });
    });
    return { trades, errors, detectedTimeZone };
  },
};
