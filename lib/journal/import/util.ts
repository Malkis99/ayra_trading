import type { TradeDirection } from "../types";

/* ------------------------------------------------------------------ headers */

/** Header key for matching: lowercase letters/digits only, text in brackets removed ("Opening time (UTC+3)" → "openingtime"). */
export function headerKey(raw: string): string {
  return (raw ?? "")
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9а-яё%]+/g, "");
}

/** Index of the first column whose key equals one of the aliases (exact first, then "starts with"). */
export function findColumn(headers: string[], aliases: string[], used: Set<number> = new Set()): number {
  const keys = headers.map(headerKey);
  const wanted = aliases.map(headerKey);
  for (const w of wanted) {
    const i = keys.findIndex((k, idx) => k === w && !used.has(idx));
    if (i >= 0) return i;
  }
  for (const w of wanted) {
    if (w.length < 4) continue;
    const i = keys.findIndex((k, idx) => k.startsWith(w) && !used.has(idx));
    if (i >= 0) return i;
  }
  return -1;
}

/** Finds the header row: the first row (within the first rows) that contains a column for every required alias group. */
export function findHeaderRow(rows: string[][], required: string[][], maxScan = 40): number {
  const limit = Math.min(rows.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row || row.filter((c) => c && c.trim()).length < required.length) continue;
    if (required.every((group) => findColumn(row, group) >= 0)) return r;
  }
  return -1;
}

/** Share of required alias groups present in the best header row (for format detection). */
export function headerScore(rows: string[][], required: string[][], optional: string[][] = []): number {
  const r = findHeaderRow(rows, required);
  if (r < 0) return 0;
  const row = rows[r];
  const extra = optional.length ? optional.filter((g) => findColumn(row, g) >= 0).length / optional.length : 1;
  return 0.6 + 0.4 * extra;
}

/** Timezone written in a header such as "Opening time (UTC+3)" or "Date(UTC)". */
export function timeZoneFromHeaders(headers: string[]): string | undefined {
  for (const h of headers) {
    const m = /\(\s*(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?\s*\)/i.exec(h ?? "");
    if (m) return formatOffset(Number(m[1]) * 60 + Math.sign(Number(m[1]) || 1) * Number(m[2] ?? 0));
    if (/\(\s*(UTC|GMT)\s*\)/i.test(h ?? "")) return "UTC";
  }
  return undefined;
}

/* ------------------------------------------------------------------ numbers */

/**
 * Parses numbers written in different locales: "1 234,56", "1,234.56", "(12.50)", "$-12", "0.01BTC", "12%".
 * Returns undefined for empty or non-numeric cells.
 */
export function parseNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (raw == null) return undefined;
  let s = String(raw).trim().replace(/[$€£¥₽₴₸]/g, "");
  if (!s || s === "-" || s === "—" || s === "--") return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s  ']/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/^[^\d.,-]+/, "").replace(/[^\d.,]+$/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return undefined;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== "0");
    s = thousands ? parts.join("") : parts.join(".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/* -------------------------------------------------------------------- dates */

const TZ_ABBR: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180, BST: 60, JST: 540, HKT: 480, SGT: 480,
};

export function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const a = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** Fixed offset in minutes for "UTC+03:00"-style zones, undefined for IANA names. */
function fixedOffset(tz: string): number | undefined {
  if (tz === "UTC" || tz === "GMT") return 0;
  const m = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tz);
  if (!m) return undefined;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Offset (minutes) of an IANA zone at a UTC instant. */
function zoneOffsetAt(utcMs: number, tz: string): number {
  const fixed = fixedOffset(tz);
  if (fixed !== undefined) return fixed;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Math.round((asUtc - utcMs) / 60000);
  } catch {
    return 0;
  }
}

/** Converts a wall-clock time in `tz` (IANA or "UTC+03:00") to a UTC timestamp. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let offset = zoneOffsetAt(guess, tz);
  const second = zoneOffsetAt(guess - offset * 60000, tz);
  if (second !== offset) offset = second;
  return guess - offset * 60000;
}

export interface DateOptions {
  timeZone: string;
  /** Force day-first for ambiguous "01/02/2024"; otherwise slash dates are month-first unless the first number > 12. */
  dayFirst?: boolean;
}

/** Parses many date formats into a UTC ISO string. Times without an offset are read in `timeZone`. */
export function parseDateTime(raw: unknown, opts: DateOptions): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;

  // IBKR Flex: "20240115;103000" or "20240115 103000" or "20240115"
  const compact = /^(\d{4})(\d{2})(\d{2})(?:[;\s,]+(\d{2}):?(\d{2}):?(\d{2}))?$/.exec(s);
  if (compact) {
    const [, y, mo, d, h = "0", mi = "0", sec = "0"] = compact;
    return new Date(zonedToUtc(+y, +mo, +d, +h, +mi, +sec, 0, opts.timeZone)).toISOString();
  }

  if (/^\d{10}(\d{3})?$/.test(s)) {
    const n = Number(s);
    return new Date(s.length === 10 ? n * 1000 : n).toISOString();
  }

  // Explicit offset / Z (ISO)
  if (/\d[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  // Trailing zone: "EST", "UTC", "+03:00", "GMT+2"
  let tz = opts.timeZone;
  const zoneMatch = /\s+(?:(UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?|([A-Z]{2,4})|([+-]\d{2}):?(\d{2}))$/.exec(s);
  if (zoneMatch) {
    let recognized = true;
    if (zoneMatch[1]) {
      const hours = Number(zoneMatch[2] ?? 0);
      tz = formatOffset(hours * 60 + (hours < 0 ? -1 : 1) * Number(zoneMatch[3] ?? 0));
    } else if (zoneMatch[4] && TZ_ABBR[zoneMatch[4]] !== undefined) tz = formatOffset(TZ_ABBR[zoneMatch[4]]);
    else if (zoneMatch[5]) {
      const hours = Number(zoneMatch[5]);
      tz = formatOffset(hours * 60 + (zoneMatch[5].startsWith("-") ? -1 : 1) * Number(zoneMatch[6]));
    } else recognized = false;
    if (recognized) s = s.slice(0, zoneMatch.index);
  }

  const m =
    /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3})\d*)?)?\s*(AM|PM)?)?$/i.exec(s) ||
    null;
  let y: number, mo: number, d: number;
  let h = 0, mi = 0, sec = 0, ms = 0;
  let ampm: string | undefined;
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
    h = Number(m[4] ?? 0);
    mi = Number(m[5] ?? 0);
    sec = Number(m[6] ?? 0);
    ms = Number((m[7] ?? "0").padEnd(3, "0"));
    ampm = m[8];
  } else {
    const m2 = /^(\d{1,2})([-./])(\d{1,2})\2(\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3})\d*)?)?\s*(AM|PM)?)?$/i.exec(s);
    if (!m2) {
      const t = Date.parse(s);
      return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    const a = Number(m2[1]);
    const b = Number(m2[3]);
    const dayFirst = m2[2] === "." || (m2[2] === "-" && a > 12) || opts.dayFirst || a > 12;
    d = dayFirst ? a : b;
    mo = dayFirst ? b : a;
    y = Number(m2[4]);
    if (y < 100) y += 2000;
    h = Number(m2[5] ?? 0);
    mi = Number(m2[6] ?? 0);
    sec = Number(m2[7] ?? 0);
    ms = Number((m2[8] ?? "0").padEnd(3, "0"));
    ampm = m2[9];
  }
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return undefined;
  return new Date(zonedToUtc(y, mo, d, h, mi, sec, ms, tz)).toISOString();
}

/** True when date cells in a column look day-first (some first number > 12 with a slash). */
export function guessDayFirst(values: string[]): boolean {
  let dayFirst = false;
  for (const v of values.slice(0, 200)) {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}/.exec((v ?? "").trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) return false;
  }
  return dayFirst;
}

/* ------------------------------------------------------------- side / misc */

export interface SideInfo {
  direction?: TradeDirection;
  /** Whether the row opens or closes a position, when the file says so. */
  effect?: "open" | "close";
  /** Buy (+1) or sell (-1) for fill-based files. */
  sign?: 1 | -1;
}

/** Reads "Buy", "SELL", "Long", "Short", "B", "S", "BOT", "SLD", "buy_to_open", "Open Long", "Close Short", "Sell Short"... */
export function parseSide(raw: unknown): SideInfo {
  const s = String(raw ?? "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2") // "BuyToCover" → "Buy To Cover"
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!s) return {};
  const effect: SideInfo["effect"] = /\b(close|closing|to close|exit|out|cover)\b/.test(s) ? "close" : /\b(open|opening|to open|entry|in)\b/.test(s) ? "open" : undefined;
  // Russian words in hand-made files
  if (/^(покупка|купить|куплено|лонг|длинная)/.test(s)) return { direction: "long", effect, sign: 1 };
  if (/^(продажа|продать|продано|шорт|короткая)/.test(s)) return { direction: "short", effect, sign: -1 };
  if (/\blong\b/.test(s)) {
    // "Close Long" is a sell that closes a long position
    return { direction: "long", effect, sign: effect === "close" ? -1 : 1 };
  }
  if (/\bshort\b/.test(s)) {
    const sellShort = /\bsell\b/.test(s);
    return { direction: "short", effect: effect ?? (sellShort ? "open" : undefined), sign: effect === "close" ? 1 : -1 };
  }
  if (/^(buy|b|bot|bought|purchase|buy to open|buy to close|buy limit|buy stop|market buy|limit buy)\b/.test(s) || s === "buy") {
    return { direction: "long", effect, sign: 1 };
  }
  if (/^(sell|s|sld|sold|sale|sell to open|sell to close|sell limit|sell stop|market sell|limit sell)\b/.test(s) || s === "sell") {
    return { direction: "short", effect, sign: -1 };
  }
  return { effect };
}

/** Uppercase instrument without spaces and broker suffixes like ".pro"/"-ECN"/"m" kept as is (only trimmed). */
export function cleanInstrument(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** True for rows that are blank or only contain totals/labels. */
export function isBlankRow(row: string[] | undefined): boolean {
  return !row || row.every((c) => !c || !String(c).trim());
}

/** Small stable hash (FNV-1a) for duplicate keys. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
