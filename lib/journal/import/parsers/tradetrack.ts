import type { ColumnMapping, ImportField, ImportParser } from "../types";
import { findColumn, findHeaderRow, headerScore } from "../util";
import { universalParser } from "./universal";

/**
 * TradeTrack journal export (CSV), checked on a real file (owner, 2026-10-19):
 * "Дата входа","Дата выхода","Счёт","Символ","Направление","Объём","PnL","Валюта","Комиссии","Прибыль (%)","Риск (%)","RR",
 * "Результат","Сессия","Стратегия". Dates are M/D/YY without a time; rows are newest first.
 * PnL is the final result of the trade: commission is stored separately and never subtracted again.
 * "Счёт" is the trading platform (e.g. "Match Trader"), not an account number. No entry / exit prices — that is normal.
 */
const REQUIRED = [["Дата входа"], ["Символ"], ["Направление"], ["PnL"], ["RR"], ["Результат"]];
const SIGNATURE = [["Дата выхода"], ["Счёт", "Счет"], ["Объём", "Объем"], ["Комиссии"], ["Прибыль (%)"], ["Риск (%)"], ["Сессия"], ["Стратегия"]];

const COLUMNS: Partial<Record<ImportField, string[]>> = {
  openedAt: ["Дата входа"],
  closedAt: ["Дата выхода"],
  instrument: ["Символ"],
  direction: ["Направление"],
  size: ["Объём", "Объем"],
  pnl: ["PnL"],
  commission: ["Комиссии"],
  riskPercent: ["Риск (%)"],
  rMultiple: ["RR"],
  outcome: ["Результат"],
  session: ["Сессия"],
  strategy: ["Стратегия"],
};

export const tradeTrackParser: ImportParser = {
  id: "tradetrack",
  group: "other",
  kinds: ["csv", "xlsx"],
  verification: "verified",
  requiredColumns: REQUIRED,
  detect(table) {
    if (table.kind !== "csv" && table.kind !== "xlsx") return 0;
    // All required columns and most of the others: TradeTrack's own set of Russian headers
    const score = headerScore(table.rows, REQUIRED, SIGNATURE);
    return score >= 0.9 ? score : 0;
  },
  parse(table, opts) {
    const headerRow = findHeaderRow(table.rows, REQUIRED);
    if (headerRow < 0) return { trades: [], errors: [] };
    const headers = table.rows[headerRow];
    const mapping: ColumnMapping = {};
    const used = new Set<number>();
    for (const [field, aliases] of Object.entries(COLUMNS) as [ImportField, string[]][]) {
      const i = findColumn(headers, aliases, used);
      if (i >= 0) {
        mapping[field] = i;
        used.add(i);
      }
    }
    // Same reading as the universal CSV (dates without time, file order within a day, R / outcome / session / strategy)
    return universalParser.parse(table, { ...opts, mapping, headerRow });
  },
};
