import type { Account, Note, Strategy, Trade } from "../types";
import { calculatePnlPercent } from "../calc";

/* =============================================================== columns */

export type ExportColumn =
  | "openedAt"
  | "closedAt"
  | "account"
  | "instrument"
  | "direction"
  | "size"
  | "entryPrice"
  | "exitPrice"
  | "stopLoss"
  | "takeProfit"
  | "pnlMoney"
  | "rMultiple"
  | "pnlPercent"
  | "fees"
  | "swap"
  | "strategy"
  | "tags"
  | "mistakes"
  | "processScore"
  | "entryReason"
  | "notes"
  | "ruleChecks";

export const BASE_COLUMNS: ExportColumn[] = [
  "openedAt",
  "closedAt",
  "account",
  "instrument",
  "direction",
  "size",
  "entryPrice",
  "exitPrice",
  "stopLoss",
  "takeProfit",
  "pnlMoney",
  "rMultiple",
  "pnlPercent",
  "fees",
  "swap",
  "strategy",
  "tags",
  "mistakes",
  "processScore",
];
export const NOTE_COLUMNS: ExportColumn[] = ["entryReason", "notes", "ruleChecks"];

export type Cell = string | number | null;

export interface ExportLabels {
  column: (c: ExportColumn) => string;
  direction: (d: Trade["direction"]) => string;
  mistake: (id: string) => string;
  ruleCheck: (v: "passed" | "failed" | "na") => string;
  defaultAccount: string;
  defaultStrategy: string;
}

export interface ExportContext {
  accounts: Account[];
  strategies: Strategy[];
  labels: ExportLabels;
  includeNotes: boolean;
}

const iso = (s?: string) => (s ? new Date(s).toISOString().replace("T", " ").slice(0, 19) : null);

/** Table of trades (header + rows). Numbers stay numbers, so spreadsheets can sum them. */
export function tradesToTable(trades: Trade[], ctx: ExportContext): Cell[][] {
  const columns = ctx.includeNotes ? [...BASE_COLUMNS, ...NOTE_COLUMNS] : BASE_COLUMNS;
  const accounts = new Map(ctx.accounts.map((a) => [a.id, a]));
  const strategies = new Map(ctx.strategies.map((s) => [s.id, s]));
  const rows: Cell[][] = [columns.map((c) => ctx.labels.column(c))];
  for (const t of trades) {
    const acc = accounts.get(t.accountId);
    const strat = t.strategyId ? strategies.get(t.strategyId) : undefined;
    const value = (c: ExportColumn): Cell => {
      switch (c) {
        case "openedAt":
          return iso(t.openedAt);
        case "closedAt":
          return iso(t.closedAt);
        case "account":
          return acc?.name || ctx.labels.defaultAccount;
        case "instrument":
          return t.instrument;
        case "direction":
          return ctx.labels.direction(t.direction);
        case "pnlPercent": {
          const pct = calculatePnlPercent(t.pnlMoney, acc?.startBalance);
          return pct == null ? null : Math.round(pct * 100) / 100;
        }
        case "strategy":
          return strat ? strat.name || ctx.labels.defaultStrategy : null;
        case "tags":
          return strat?.tags?.length ? strat.tags.join(", ") : null;
        case "mistakes":
          return t.mistakes?.length ? t.mistakes.map(ctx.labels.mistake).join(", ") : null;
        case "ruleChecks": {
          if (!strat || !t.ruleChecks || !Object.keys(t.ruleChecks).length) return null;
          return strat.rules
            .filter((r) => t.ruleChecks?.[r.id])
            .map((r) => `${r.text}: ${ctx.labels.ruleCheck(t.ruleChecks![r.id])}`)
            .join("; ");
        }
        case "processScore":
          return t.processScore ?? null;
        default: {
          const v = (t as unknown as Record<string, unknown>)[c];
          return typeof v === "number" || typeof v === "string" ? v : null;
        }
      }
    };
    rows.push(columns.map(value));
  }
  return rows;
}

/* =================================================================== CSV */

/** Spreadsheet formula injection guard: text starting with = + - @ (or tab/CR) is prefixed with an apostrophe. */
export function guardCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvQuote(s: string): string {
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 CSV with BOM (Excel opens Cyrillic correctly) and CRLF line ends. */
export function tableToCsv(table: Cell[][]): string {
  return "﻿" + table.map((row) => row.map((c) => csvQuote(guardCell(c))).join(",")).join("\r\n") + "\r\n";
}

/* ================================================================== XLSX */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (stored, no compression) — enough for a valid .xlsx without extra libraries. */
export function writeZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const xmlEscape = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** One-sheet .xlsx with inline strings and numeric cells. */
export function tableToXlsx(table: Cell[][], sheetName = "Trades"): Uint8Array {
  const enc = new TextEncoder();
  const rowsXml = table
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(guardCell(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/styles.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`
      ),
    },
  ];
  return writeZip(files);
}

/* ================================================================== JSON */

/**
 * v1.3 (T7b-1): records carry updatedAt; soft-deleted records are never exported (deletedAt is not written).
 * Older files (≤1.2) stay importable.
 */
export const AYRA_TRADES_EXPORT_VERSION = "1.3";

const notDeleted = <T extends { deletedAt?: string | null }>(r: T) => !r.deletedAt;
function stripDeleted<T extends { deletedAt?: string | null }>(r: T): Omit<T, "deletedAt"> {
  const { deletedAt: _d, ...rest } = r;
  return rest;
}

/** AYRA trades export (kind "trades", v1.3). Screenshots are never included; notes/checklists only on request. */
export function tradesToJson(
  trades: Trade[],
  data: { accounts: Account[]; strategies: Strategy[]; notes: Note[] },
  includeNotes: boolean,
  now: Date = new Date()
): string {
  trades = trades.filter(notDeleted);
  const accountIds = new Set(trades.map((t) => t.accountId));
  const strategyIds = new Set(trades.map((t) => t.strategyId).filter(Boolean));
  const tradeIds = new Set(trades.map((t) => t.id));
  const payload = {
    app: "ayra",
    kind: "trades",
    exportVersion: AYRA_TRADES_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    accounts: data.accounts.filter((a) => notDeleted(a) && accountIds.has(a.id)).map(({ propRules: _p, deletedAt: _d, ...a }) => a),
    strategies: data.strategies.filter((s) => notDeleted(s) && strategyIds.has(s.id)).map(stripDeleted),
    trades: trades.map((t) => {
      const { attachmentIds: _a, deletedAt: _d, ...rest } = t;
      if (includeNotes) return rest;
      const { notes: _n, entryReason: _e, ruleChecks: _r, ...lean } = rest;
      return lean;
    }),
    notes: includeNotes ? data.notes.filter((n) => notDeleted(n) && n.links?.tradeId && tradeIds.has(n.links.tradeId)).map(stripDeleted) : [],
  };
  return JSON.stringify(payload, null, 2);
}

/* ================================================================ naming */

export type ExportFormat = "csv" | "xlsx" | "json";

export function exportFileName(format: ExportFormat, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `ayra-trades-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${format}`;
}
