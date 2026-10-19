import type { ColumnMapping, ImportField, ImportParser, NormalizedTrade, RowError } from "../types";
import {
  cleanInstrument,
  findColumn,
  guessDayFirst,
  isBlankRow,
  isDateOnly,
  parseDateTime,
  parseNumber,
  parseOutcome,
  parseSession,
  parseSide,
  timeZoneFromHeaders,
} from "../util";

/** Common header names per field (English and Russian), used to pre-fill the manual mapping. Order = priority. */
export const FIELD_ALIASES: Record<ImportField, string[]> = {
  instrument: ["Instrument", "Symbol", "Ticker", "Pair", "Market", "Asset", "Contract", "Инструмент", "Символ", "Тикер"],
  direction: ["Direction", "Side", "Type", "Action", "Position", "Buy/Sell", "Long/Short", "Направление", "Тип"],
  openedAt: ["Open Time", "Entry Time", "Opened", "Open Date", "Entry Date", "Время входа", "Дата входа", "Время открытия", "Дата открытия", "Date", "Time", "Дата"],
  closedAt: ["Close Time", "Exit Time", "Closed", "Close Date", "Exit Date", "Время выхода", "Дата выхода", "Время закрытия", "Дата закрытия"],
  entryPrice: ["Entry Price", "Open Price", "Entry", "Цена входа", "Цена открытия"],
  exitPrice: ["Exit Price", "Close Price", "Exit", "Цена выхода", "Цена закрытия"],
  size: ["Size", "Volume", "Qty", "Quantity", "Lots", "Amount", "Объём", "Объем", "Количество"],
  pnl: ["Profit", "P&L", "PnL", "Net P&L", "Net PnL", "Result", "Прибыль", "Результат"],
  commission: ["Commission", "Commissions", "Fee", "Fees", "Комиссия", "Комиссии"],
  swap: ["Swap", "Financing", "Своп"],
  stopLoss: ["Stop Loss", "SL", "S/L", "Стоп"],
  takeProfit: ["Take Profit", "TP", "T/P", "Тейк"],
  rMultiple: ["R Multiple", "R-Multiple", "Realized R", "RR", "R:R", "R"],
  riskPercent: ["Risk %", "Risk (%)", "Risk Percent", "Риск (%)", "Риск %", "Risk", "Риск"],
  outcome: ["Outcome", "Exit Reason", "Close Reason", "Result", "Исход", "Результат"],
  session: ["Session", "Сессия"],
  strategy: ["Strategy", "Setup", "Model", "Стратегия", "Сетап", "Модель"],
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
  "rMultiple",
  "riskPercent",
  "outcome",
  "session",
  "strategy",
  "externalId",
];

export const REQUIRED_FIELDS: ImportField[] = ["instrument", "direction", "openedAt"];

const NUMERIC_FIELDS = new Set<ImportField>(["entryPrice", "exitPrice", "size", "pnl", "commission", "swap", "stopLoss", "takeProfit", "rMultiple", "riskPercent"]);

/** Best guess of the header row: the first row with at least 3 non-numeric cells. */
export function guessHeaderRow(rows: string[][]): number {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const textCells = rows[r].filter((c) => c && !/^[-+\d.,\s%$()]+$/.test(c)).length;
    if (textCells >= 3) return r;
  }
  return 0;
}

/** A number field mapped to a column whose filled values contain no number at all (e.g. P&L -> "TP"/"SL"). */
export function mappedColumnHasNoNumbers(field: ImportField, rows: string[][], index: number | undefined): boolean {
  if (!NUMERIC_FIELDS.has(field) || index === undefined || index < 0) return false;
  const filled = rows.slice(0, 50).map((r) => r[index] ?? "").filter((v) => v.trim());
  return filled.length > 0 && filled.every((v) => parseNumber(v) === undefined);
}

/** A column fits a field when its sample values look right (numbers for amounts, TP/SL for the outcome). */
function columnFits(field: ImportField, header: string, samples: string[] | undefined): boolean {
  // "Прибыль (%)" / "Profit %" is a percentage, not money
  if (field === "pnl" && /%/.test(header)) return false;
  if (!samples) return true;
  const filled = samples.filter((v) => v && v.trim());
  if (!filled.length) return true;
  if (NUMERIC_FIELDS.has(field)) return filled.some((v) => parseNumber(v) !== undefined);
  if (field === "outcome") return filled.some((v) => parseOutcome(v) !== undefined);
  return true;
}

/**
 * Pre-fills the mapping from header names (and, when given, the first data rows to check the values fit);
 * the user can change every field.
 */
export function suggestMapping(headers: string[], dataRows?: string[][]): ColumnMapping {
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of MAPPABLE_FIELDS) {
    const rejected = new Set<number>();
    for (;;) {
      const i = findColumn(headers, FIELD_ALIASES[field], new Set([...used, ...rejected]));
      if (i < 0) break;
      const samples = dataRows?.slice(0, 20).map((r) => r[i] ?? "");
      if (columnFits(field, headers[i] ?? "", samples)) {
        mapping[field] = i;
        used.add(i);
        break;
      }
      rejected.add(i);
    }
  }
  return mapping;
}

/** A remembered mapping plus guesses for fields it does not mention (fields added in later app versions). */
export function completeMapping(remembered: ColumnMapping, headers: string[], dataRows?: string[][]): ColumnMapping {
  const guess = suggestMapping(headers, dataRows);
  const taken = new Set(Object.values(remembered).filter((i) => i !== undefined && i >= 0));
  const out: ColumnMapping = { ...remembered };
  for (const f of MAPPABLE_FIELDS) {
    if (out[f] !== undefined) continue;
    const g = guess[f];
    if (g !== undefined && !taken.has(g)) {
      out[f] = g;
      taken.add(g);
    }
  }
  return out;
}

/**
 * Dates without a time: trades of one day get increasing milliseconds in the order they happened, so the journal
 * keeps the file order (files newest-first, like TradeTrack, are read bottom-up). The minute stays the same,
 * so duplicate keys do not depend on the position in the file.
 */
function orderDateOnly(trades: (NormalizedTrade & { _openDateOnly: boolean; _closeDateOnly: boolean })[]): void {
  const dated = trades.filter((t) => t._openDateOnly);
  if (!dated.length) return;
  const newestFirst = dated[0].openedAt > dated[dated.length - 1].openedAt;
  const chronological = newestFirst ? [...dated].reverse() : dated;
  const perDay = new Map<string, number>();
  for (const t of chronological) {
    const n = perDay.get(t.openedAt) ?? 0;
    perDay.set(t.openedAt, n + 1);
    const openMs = Date.parse(t.openedAt) + n;
    if (t.closedAt && t._closeDateOnly) {
      const closeDay = Date.parse(t.closedAt);
      t.closedAt = new Date(Math.max(openMs, closeDay + n)).toISOString();
    }
    t.openedAt = new Date(openMs).toISOString();
  }
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
    const rows = table.rows.slice(headerRow + 1);
    const mapping = opts.mapping ?? suggestMapping(headers, rows);
    const detectedTimeZone = timeZoneFromHeaders(headers);
    const timeZone = detectedTimeZone ?? opts.timeZone;
    const trades: (NormalizedTrade & { _openDateOnly: boolean; _closeDateOnly: boolean })[] = [];
    const errors: RowError[] = [];
    const get = (row: string[], f: ImportField) => {
      const i = mapping[f];
      return i === undefined || i < 0 ? undefined : row[i];
    };
    const dayFirst = guessDayFirst(rows.map((r) => get(r, "openedAt") ?? ""));
    rows.forEach((row, i) => {
      const n = headerRow + 2 + i;
      if (isBlankRow(row)) return;
      const instrument = cleanInstrument(get(row, "instrument"));
      const side = parseSide(get(row, "direction"));
      const openedRaw = get(row, "openedAt");
      const openedAt = parseDateTime(openedRaw, { timeZone, dayFirst });
      if (!instrument) return errors.push({ row: n, code: "missingInstrument", field: "instrument" });
      if (!side.direction) return errors.push({ row: n, code: "missingDirection", field: "direction" });
      if (!openedAt) return errors.push({ row: n, code: openedRaw ? "badTime" : "missingTime", field: "openedAt" });
      const num = (f: ImportField) => parseNumber(get(row, f));
      const commission = num("commission");
      const closedRaw = get(row, "closedAt");
      const strategyName = (get(row, "strategy") ?? "").trim();
      trades.push({
        externalId: get(row, "externalId") || undefined,
        instrument,
        direction: side.direction,
        openedAt,
        closedAt: parseDateTime(closedRaw, { timeZone, dayFirst }),
        entryPrice: num("entryPrice"),
        exitPrice: num("exitPrice"),
        size: num("size") !== undefined ? Math.abs(num("size")!) : undefined,
        profit: num("pnl"),
        // A universal file gives the final result: commission is kept as its own field, never subtracted again
        profitIsNet: true,
        commission: commission !== undefined ? Math.abs(commission) : undefined,
        swap: num("swap"),
        stopLoss: num("stopLoss") || undefined,
        takeProfit: num("takeProfit") || undefined,
        rMultiple: num("rMultiple"),
        riskPercent: num("riskPercent"),
        outcome: parseOutcome(get(row, "outcome")),
        session: parseSession(get(row, "session")),
        strategyName: strategyName || undefined,
        rows: [n],
        _openDateOnly: isDateOnly(openedRaw),
        _closeDateOnly: isDateOnly(closedRaw),
      });
    });
    orderDateOnly(trades);
    return {
      trades: trades.map(({ _openDateOnly, _closeDateOnly, ...t }) => t),
      errors,
      detectedTimeZone,
    };
  },
};
