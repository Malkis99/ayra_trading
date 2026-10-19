import type { TradeDirection } from "../types";
import type { ImportFormatId, ImportParser, ImportPlatformGroup, NormalizedTrade, ParseOptions, ParseResult, RawTable, RowError } from "./types";
import {
  cleanInstrument,
  findColumn,
  findHeaderRow,
  guessDayFirst,
  headerScore,
  isBlankRow,
  parseDateTime,
  parseNumber,
  parseSide,
  timeZoneFromHeaders,
} from "./util";

type Aliases = string[];

/* =================================================================== *
 *  Round-trip files: one row = one closed trade                         *
 * =================================================================== */

export interface RoundTripConfig {
  id: ImportFormatId;
  group: ImportPlatformGroup;
  kinds: RawTable["kind"][];
  verification?: "verified" | "documented";
  /** Alias groups that must all be present in the header row. */
  required: Aliases[];
  /** Extra alias groups that raise detection confidence. */
  signature?: Aliases[];
  columns: {
    instrument: Aliases;
    direction?: Aliases;
    openedAt: Aliases;
    closedAt?: Aliases;
    entryPrice?: Aliases;
    exitPrice?: Aliases;
    size?: Aliases;
    profit?: Aliases;
    /** Net result (profit after commission and swap); used when there is no gross profit column. */
    netProfit?: Aliases;
    commission?: Aliases;
    swap?: Aliases;
    stopLoss?: Aliases;
    takeProfit?: Aliases;
    externalId?: Aliases;
  };
  /** Several columns share a name (MT: "Time", "Price" twice): take the n-th occurrence for these fields. */
  repeated?: Partial<Record<"openedAt" | "closedAt" | "entryPrice" | "exitPrice", { alias: string; occurrence: number }>>;
  /** Derive direction when there is no side column (e.g. Tradovate: buy time before sell time). */
  directionFrom?: (row: string[], cols: Record<string, number>, opts: ParseOptions) => TradeDirection | undefined;
  /** Rows that are not trades (balance, deposits, totals). */
  skipRow?: (row: string[], cols: Record<string, number>) => boolean;
  /** Commission is written as a negative number (most platforms) — stored as a positive cost. */
  commissionNegative?: boolean;
  /** Rows end at the first blank row after the header (HTML reports with several sections). */
  stopAtBlank?: boolean;
  /** Stop when a row's first cell matches (next section title). */
  stopAt?: RegExp;
}

function nthColumn(headers: string[], alias: string, occurrence: number): number {
  let seen = 0;
  const key = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let i = 0; i < headers.length; i++) {
    if ((headers[i] ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "") === key) {
      seen++;
      if (seen === occurrence) return i;
    }
  }
  return -1;
}

export function roundTripParser(cfg: RoundTripConfig): ImportParser {
  return {
    id: cfg.id,
    group: cfg.group,
    kinds: cfg.kinds,
    verification: cfg.verification ?? "documented",
    requiredColumns: cfg.required,
    detect(table) {
      if (!cfg.kinds.includes(table.kind)) return 0;
      return headerScore(table.rows, cfg.required, cfg.signature ?? []);
    },
    parse(table, opts) {
      return parseRoundTrip(table, opts, cfg);
    },
  };
}

function parseRoundTrip(table: RawTable, opts: ParseOptions, cfg: RoundTripConfig): ParseResult {
  const h = findHeaderRow(table.rows, cfg.required);
  const errors: RowError[] = [];
  const trades: NormalizedTrade[] = [];
  if (h < 0) return { trades, errors };
  const headers = table.rows[h];
  const detectedTimeZone = timeZoneFromHeaders(headers);
  const timeZone = detectedTimeZone ?? opts.timeZone;

  const used = new Set<number>();
  const cols: Record<string, number> = {};
  const take = (field: string, aliases?: Aliases) => {
    if (!aliases) return;
    const i = findColumn(headers, aliases, used);
    if (i >= 0) {
      cols[field] = i;
      used.add(i);
    }
  };
  for (const [field, rep] of Object.entries(cfg.repeated ?? {})) {
    if (!rep) continue;
    const i = nthColumn(headers, rep.alias, rep.occurrence);
    if (i >= 0) {
      cols[field] = i;
      used.add(i);
    }
  }
  for (const [field, aliases] of Object.entries(cfg.columns)) {
    if (cols[field] === undefined) take(field, aliases as Aliases);
  }

  const dataRows: Array<{ row: string[]; n: number }> = [];
  for (let r = h + 1; r < table.rows.length; r++) {
    const row = table.rows[r];
    if (isBlankRow(row)) {
      if (cfg.stopAtBlank && dataRows.length) break;
      continue;
    }
    if (cfg.stopAt && cfg.stopAt.test(row[0] ?? "")) break;
    dataRows.push({ row, n: r + 1 });
  }
  const dayFirst = guessDayFirst(dataRows.map((d) => d.row[cols.openedAt] ?? ""));
  const num = (row: string[], field: string) => (cols[field] === undefined ? undefined : parseNumber(row[cols[field]]));

  for (const { row, n } of dataRows) {
    if (cfg.skipRow?.(row, cols)) continue;
    const instrument = cleanInstrument(row[cols.instrument]);
    const direction =
      cfg.directionFrom?.(row, cols, opts) ?? (cols.direction !== undefined ? parseSide(row[cols.direction]).direction : undefined);
    const openedAt = parseDateTime(row[cols.openedAt], { timeZone, dayFirst });
    // Totals / summary lines: no instrument and no time
    if (!instrument && !openedAt) continue;
    if (!instrument) {
      errors.push({ row: n, code: "missingInstrument" });
      continue;
    }
    if (!direction) {
      errors.push({ row: n, code: "missingDirection", field: headers[cols.direction ?? -1] });
      continue;
    }
    if (!openedAt) {
      errors.push({ row: n, code: row[cols.openedAt] ? "badTime" : "missingTime", field: headers[cols.openedAt] });
      continue;
    }
    const closedAt = cols.closedAt !== undefined ? parseDateTime(row[cols.closedAt], { timeZone, dayFirst }) : undefined;
    const commissionRaw = num(row, "commission");
    const swap = num(row, "swap");
    let profit = num(row, "profit");
    if (profit === undefined && cfg.columns.netProfit) {
      const net = num(row, "netProfit");
      if (net !== undefined) profit = net + Math.abs(commissionRaw ?? 0) - (swap ?? 0);
    }
    trades.push({
      externalId: cols.externalId !== undefined ? row[cols.externalId] || undefined : undefined,
      instrument,
      direction,
      openedAt,
      closedAt,
      entryPrice: num(row, "entryPrice"),
      exitPrice: num(row, "exitPrice"),
      size: num(row, "size") !== undefined ? Math.abs(num(row, "size")!) : undefined,
      profit,
      commission: commissionRaw !== undefined ? Math.abs(commissionRaw) : undefined,
      swap,
      stopLoss: num(row, "stopLoss") || undefined,
      takeProfit: num(row, "takeProfit") || undefined,
      rows: [n],
    });
  }
  return { trades, errors, detectedTimeZone };
}

/* =================================================================== *
 *  Fill files: one row = one execution, paired into trades (FIFO)       *
 * =================================================================== */

export interface Fill {
  row: number;
  time: string;
  instrument: string;
  /** +1 buy, -1 sell */
  sign: 1 | -1;
  qty: number;
  price: number;
  fee?: number;
  /** Realized P&L reported by the platform for a closing fill. */
  realized?: number;
  effect?: "open" | "close";
  id?: string;
}

export interface FillsConfig {
  id: ImportFormatId;
  group: ImportPlatformGroup;
  kinds: RawTable["kind"][];
  verification?: "verified" | "documented";
  required: Aliases[];
  signature?: Aliases[];
  columns: {
    time: Aliases;
    instrument: Aliases;
    side: Aliases;
    qty: Aliases;
    price: Aliases;
    fee?: Aliases;
    realized?: Aliases;
    effect?: Aliases;
    id?: Aliases;
    status?: Aliases;
    /** Signed quantity column (negative = sell) when there is no side column value. */
  };
  /** Only rows whose status matches are fills (e.g. "Filled"). */
  statusFilled?: RegExp;
  /** Profit is computed from prices only for spot/FX/stocks; futures need a contract multiplier we do not know. */
  computeProfit: boolean;
  /** Ignore non-trade rows (deposits, fees, dividends). */
  skipRow?: (row: string[], cols: Record<string, number>) => boolean;
  /** Quantity column is signed (negative = sell). */
  signedQty?: boolean;
}

export function fillsParser(cfg: FillsConfig): ImportParser {
  return {
    id: cfg.id,
    group: cfg.group,
    kinds: cfg.kinds,
    verification: cfg.verification ?? "documented",
    requiredColumns: cfg.required,
    detect(table) {
      if (!cfg.kinds.includes(table.kind)) return 0;
      return headerScore(table.rows, cfg.required, cfg.signature ?? []);
    },
    parse(table, opts) {
      const read = readFills(table, opts, cfg);
      const paired = pairFills(read.fills, cfg.computeProfit);
      return { trades: paired.trades, errors: [...read.errors, ...paired.errors], detectedTimeZone: read.detectedTimeZone };
    },
  };
}

export function readFills(table: RawTable, opts: ParseOptions, cfg: FillsConfig): { fills: Fill[]; errors: RowError[]; detectedTimeZone?: string } {
  const h = findHeaderRow(table.rows, cfg.required);
  const errors: RowError[] = [];
  const fills: Fill[] = [];
  if (h < 0) return { fills, errors };
  const headers = table.rows[h];
  const detectedTimeZone = timeZoneFromHeaders(headers);
  const timeZone = detectedTimeZone ?? opts.timeZone;
  const used = new Set<number>();
  const cols: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(cfg.columns)) {
    if (!aliases) continue;
    const i = findColumn(headers, aliases as Aliases, used);
    if (i >= 0) {
      cols[field] = i;
      used.add(i);
    }
  }
  const rows = table.rows.slice(h + 1).map((row, i) => ({ row, n: h + 2 + i }));
  const dayFirst = guessDayFirst(rows.map((r) => r.row[cols.time] ?? ""));
  for (const { row, n } of rows) {
    if (isBlankRow(row)) continue;
    // A repeated header row (multi-section files) or a different section
    if (findColumn(row, cfg.columns.time) === cols.time && findColumn(row, cfg.columns.price) === cols.price) continue;
    if (cfg.skipRow?.(row, cols)) continue;
    if (cfg.statusFilled && cols.status !== undefined && !cfg.statusFilled.test(row[cols.status] ?? "")) continue;
    const instrument = cleanInstrument(row[cols.instrument]);
    const time = parseDateTime(row[cols.time], { timeZone, dayFirst });
    const qtyRaw = parseNumber(row[cols.qty]);
    const price = parseNumber(row[cols.price]);
    const side = parseSide(row[cols.side]);
    const effect = side.effect ?? (cols.effect !== undefined ? parseSide(row[cols.effect]).effect : undefined);
    let sign = side.sign;
    if (!sign && cfg.signedQty && qtyRaw) sign = qtyRaw < 0 ? -1 : 1;
    if (!instrument && !time) continue;
    if (!instrument) {
      errors.push({ row: n, code: "missingInstrument" });
      continue;
    }
    if (!time) {
      errors.push({ row: n, code: row[cols.time] ? "badTime" : "missingTime", field: headers[cols.time] });
      continue;
    }
    if (!sign) {
      errors.push({ row: n, code: "missingDirection", field: headers[cols.side] });
      continue;
    }
    if (!qtyRaw || price === undefined) {
      errors.push({ row: n, code: "badNumber", field: headers[!qtyRaw ? cols.qty : cols.price] });
      continue;
    }
    const fee = cols.fee !== undefined ? parseNumber(row[cols.fee]) : undefined;
    const realized = cols.realized !== undefined ? parseNumber(row[cols.realized]) : undefined;
    fills.push({
      row: n,
      time,
      instrument,
      sign,
      qty: Math.abs(qtyRaw),
      price,
      fee: fee !== undefined ? Math.abs(fee) : undefined,
      realized: realized || undefined,
      effect,
      id: cols.id !== undefined ? row[cols.id] || undefined : undefined,
    });
  }
  return { fills, errors, detectedTimeZone };
}

const EPS = 1e-9;

/**
 * Pairs executions into round-trip trades per instrument (FIFO average): a trade opens when the
 * position leaves zero and closes when it returns to zero; a reversal closes one trade and opens the next.
 * Positions still open at the end of the file are reported as unpaired fills (not imported).
 */
export function pairFills(fills: Fill[], computeProfit: boolean): { trades: NormalizedTrade[]; errors: RowError[] } {
  const trades: NormalizedTrade[] = [];
  const errors: RowError[] = [];
  const byInstrument = new Map<string, Fill[]>();
  for (const f of fills) byInstrument.set(f.instrument, [...(byInstrument.get(f.instrument) ?? []), f]);

  for (const [instrument, list] of byInstrument) {
    list.sort((a, b) => a.time.localeCompare(b.time) || a.row - b.row);
    let pos = 0;
    let cur: {
      direction: TradeDirection;
      openedAt: string;
      entryQty: number;
      entryValue: number;
      exitQty: number;
      exitValue: number;
      fees: number;
      realized: number;
      hasRealized: boolean;
      rows: number[];
      id?: string;
    } | null = null;

    for (const f of list) {
      let qty = f.qty;
      if (Math.abs(pos) < EPS && f.effect === "close") {
        errors.push({ row: f.row, code: "unpairedFill" });
        continue;
      }
      while (qty > EPS) {
        if (!cur || Math.abs(pos) < EPS) {
          cur = {
            direction: f.sign > 0 ? "long" : "short",
            openedAt: f.time,
            entryQty: 0,
            entryValue: 0,
            exitQty: 0,
            exitValue: 0,
            fees: 0,
            realized: 0,
            hasRealized: false,
            rows: [],
            id: f.id,
          };
          pos = 0;
        }
        if (!cur.rows.includes(f.row)) cur.rows.push(f.row);
        const sameSide = Math.sign(pos) === f.sign || Math.abs(pos) < EPS;
        if (sameSide) {
          cur.entryQty += qty;
          cur.entryValue += qty * f.price;
          cur.fees += f.fee ?? 0;
          pos += f.sign * qty;
          qty = 0;
        } else {
          const closeQty = Math.min(qty, Math.abs(pos));
          const share = closeQty / f.qty;
          cur.exitQty += closeQty;
          cur.exitValue += closeQty * f.price;
          cur.fees += (f.fee ?? 0) * share;
          if (f.realized !== undefined) {
            cur.realized += f.realized * share;
            cur.hasRealized = true;
          }
          pos += f.sign * closeQty;
          qty -= closeQty;
          if (Math.abs(pos) < EPS) {
            const entryPrice = cur.entryValue / cur.entryQty;
            const exitPrice = cur.exitValue / cur.exitQty;
            const dir = cur.direction === "long" ? 1 : -1;
            const profit = cur.hasRealized ? cur.realized : computeProfit ? (exitPrice - entryPrice) * cur.entryQty * dir : undefined;
            trades.push({
              externalId: cur.id,
              instrument,
              direction: cur.direction,
              openedAt: cur.openedAt,
              closedAt: f.time,
              entryPrice: round(entryPrice),
              exitPrice: round(exitPrice),
              size: round(cur.entryQty),
              profit: profit !== undefined ? round(profit, 2) : undefined,
              commission: cur.fees ? round(cur.fees, 4) : undefined,
              rows: cur.rows,
            });
            cur = null;
            pos = 0;
          }
        }
      }
    }
    if (cur && Math.abs(pos) > EPS) cur.rows.forEach((row) => errors.push({ row, code: "unpairedFill" }));
  }
  trades.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  return { trades, errors };
}

function round(n: number, digits = 8): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
