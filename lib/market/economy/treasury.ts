import { cents, type FiscalPoint, type FiscalSeries, type FiscalRange } from "./fiscal-data";

const base = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/";
const maxPages = 20;
const settings = {
  debt: { path: "v2/accounting/od/debt_to_penny", from: "1993-04-01", pageSize: 3000,
    fields: "record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt", order: "record_date" },
  budget: { path: "v1/accounting/mts/mts_table_1", from: "2015-03-31", pageSize: 1000,
    fields: "record_date,classification_id,parent_id,classification_desc,record_type_cd,record_fiscal_year,current_month_gross_rcpt_amt,current_month_gross_outly_amt,current_month_dfct_sur_amt,src_line_nbr",
    order: "record_date,src_line_nbr", extraFilter: ",line_code_nbr:in:(150,160,170,180,190,200,210,220,230,240,250,260,270,280)" },
  interest: { path: "v2/accounting/od/interest_expense", from: "2010-05-31", pageSize: 1000,
    fields: "record_date,record_fiscal_year,month_expense_amt,fytd_expense_amt,src_line_nbr,expense_catg_desc,expense_group_desc,expense_type_desc",
    order: "record_date,src_line_nbr" },
};

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export class TreasuryThrottle extends Error {
  constructor(readonly until: number) { super("Treasury temporarily unavailable"); }
}

type Failure = "timeout" | "network" | "http" | "content_type" | "schema" | "pagination" | "validation" | "throttled";
export class TreasuryFailure extends Error {
  constructor(readonly category: Failure, readonly pages: number, readonly durationMs: number,
    readonly retryAt?: number, message: string = category) { super(message); }
}
class PageError extends Error {
  constructor(readonly category: Failure, message: string) { super(message); }
}

async function readPage(series: FiscalSeries, from: string, until: string, page: number, pageSize: number, signal: AbortSignal, request: typeof fetch) {
  const config = settings[series];
  const url = new URL(config.path, base);
  const extra = "extraFilter" in config ? config.extraFilter : "";
  url.search = new URLSearchParams({ fields: config.fields, filter: `record_date:gte:${from},record_date:lte:${until}${extra}`,
    sort: config.order, "page[size]": String(pageSize), "page[number]": String(page) }).toString();
  const response = await request(url, { cache: "no-store", redirect: "error", signal });
  if (response.status === 429 || response.status === 503) {
    const raw = response.headers.get("Retry-After")?.trim() ?? "";
    const now = Date.now();
    const until = /^\d+$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(raw);
    throw new TreasuryThrottle(Number.isFinite(until) ? Math.max(until, now + 60_000) : now + 300_000);
  }
  if (!response.ok) throw new PageError("http", "Treasury response unavailable");
  if (!response.headers.get("content-type")?.includes("application/json")) throw new PageError("content_type", "Treasury response unavailable");
  const payload: unknown = await response.json().catch(error => {
    if (signal.aborted) throw error;
    throw new PageError("schema", "Treasury invalid JSON");
  });
  if (!object(payload) || !Array.isArray(payload.data) || !payload.data.every(object) || !object(payload.meta)) throw new PageError("schema", "Treasury schema mismatch");
  const total = payload.meta["total-count"];
  const pages = payload.meta["total-pages"];
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || typeof pages !== "number"
    || total > pageSize * maxPages || pages !== Math.ceil(total / pageSize)
    || payload.meta.count !== payload.data.length
    || payload.data.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) {
    throw new PageError("pagination", "Invalid Treasury pagination");
  }
  return { rows: payload.data, total, pages };
}

function dateOf(row: Row): string {
  const date = row.record_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid Treasury date");
  const time = Date.parse(date);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error("Invalid Treasury date");
  return date;
}

const dollars = (row: Row, fields: string[]) => fields.map(field => cents(row[field]));

function budgetAmounts(row: Row) {
  const [receipts, outlays, deficit] = dollars(row, ["current_month_gross_rcpt_amt", "current_month_gross_outly_amt", "current_month_dfct_sur_amt"]);
  const drift = receipts - outlays + deficit;
  if (drift > BigInt(2) || drift < BigInt(-2)) throw new Error("Treasury budget does not reconcile");
  return [receipts, outlays, -deficit].map(String);
}

function one(rows: Row[]) {
  if (rows.length !== 1) throw new Error("Missing or duplicate Treasury observation");
  return rows[0];
}

export function normalizeTreasury(series: FiscalSeries, rows: Row[]): FiscalPoint[] {
  const dates = new Map<string, Row[]>();
  for (const row of rows) {
    const date = dateOf(row);
    const existing = dates.get(date);
    if (existing) existing.push(row);
    else dates.set(date, [row]);
  }
  const points = [...dates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]): FiscalPoint => {
    if (series === "debt") {
      const row = one(entries);
      const total = cents(row.tot_pub_debt_out_amt);
      if (total < BigInt(0)) throw new Error("Invalid Treasury debt balance");
      if (row.debt_held_public_amt === "null" && row.intragov_hold_amt === "null") return { date, values: [String(total), null, null] };
      const [publicDebt, intra] = dollars(row, ["debt_held_public_amt", "intragov_hold_amt"]);
      if (publicDebt < BigInt(0) || intra < BigInt(0)) throw new Error("Invalid Treasury debt balance");
      const difference = total - publicDebt - intra;
      if (difference < BigInt(-1) || difference > BigInt(1)) return { date, values: [String(total), null, null] };
      return { date, values: [total, publicDebt, intra].map(String) };
    }
    const month = Number(date.slice(5, 7));
    const fiscalYear = Number(date.slice(0, 4)) + (month >= 10 ? 1 : 0);
    if (entries.some(row => row.record_fiscal_year !== String(fiscalYear))) throw new Error("Treasury fiscal year mismatch");
    if (series === "interest") {
      const categories = new Set<string>();
      const keys = new Set<string>();
      let monthly = BigInt(0);
      let ytd = BigInt(0);
      for (const [index, row] of entries.entries()) {
        const category = row.expense_catg_desc;
        const group = row.expense_group_desc;
        const type = row.expense_type_desc;
        if ((category !== "INTEREST EXPENSE ON PUBLIC ISSUES" && category !== "INTEREST EXPENSE ON GOVT ACCOUNT SERIES")
          || typeof group !== "string" || typeof type !== "string" || /\b(?:sub)?total\b/i.test(group + " " + type)
          || row.src_line_nbr !== String(index + 1)) throw new Error("Unexpected Treasury interest breakdown");
        const key = JSON.stringify([category, group, type]);
        if (keys.has(key)) throw new Error("Duplicate Treasury interest component");
        keys.add(key);
        categories.add(category);
        monthly += cents(row.month_expense_amt);
        ytd += cents(row.fytd_expense_amt);
      }
      if (categories.size !== 2) throw new Error("Incomplete Treasury interest breakdown");
      return { date, fiscalYear, values: [String(monthly)], ytd: [String(ytd)] };
    }
    const parent = one(entries.filter(row => row.classification_desc === `FY ${fiscalYear}` && row.parent_id === "null"));
    if (typeof parent.classification_id !== "string" || !/^\d+$/.test(parent.classification_id)) throw new Error("Invalid Treasury budget classification");
    const children = entries.filter(row => row.parent_id === parent.classification_id);
    const monthly = one(children.filter(row => row.record_type_cd === "MTH" && row.classification_desc === months[month - 1]));
    const ytd = one(children.filter(row => row.record_type_cd === "SL" && row.classification_desc === "Year-to-Date"));
    return { date, fiscalYear, values: budgetAmounts(monthly), ytd: budgetAmounts(ytd) };
  });
  if (series === "debt" && points.at(-1)?.values.includes(null)) throw new Error("Incomplete latest Treasury debt breakdown or reconciliation failure");
  return points;
}

export async function loadTreasury(series: FiscalSeries, until: string, request = fetch, range: FiscalRange = "max") {
  const started = performance.now();
  const signal = AbortSignal.timeout(range === "latest" ? 8_000 : 38_000);
  const cutoff = new Date(until);
  if (range === "latest") cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  else if (range !== "max") {
    // Include the whole reference month for monthly flows.
    if (series !== "debt") cutoff.setUTCDate(1);
    const month = cutoff.getUTCMonth();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(range));
    if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0);
  }
  const from = range === "max" ? settings[series].from : [settings[series].from, cutoff.toISOString().slice(0, 10)].sort()[1];
  const size = range === "latest" ? 250 : settings[series].pageSize;
  let processed = 0;
  let validating = false;
  try {
    const first = await readPage(series, from, until, 1, size, signal, request);
    processed++;
    const rows = first.rows;
    // One page at a time so Retry-After can stop any remaining requests.
    for (let page = 2; page <= first.pages; page++) {
      const next = await readPage(series, from, until, page, size, signal, request);
      if (next.total !== first.total || next.pages !== first.pages) throw new PageError("pagination", "Treasury pagination changed");
      processed++;
      rows.push(...next.rows);
    }
    validating = true;
    if (rows.some(row => dateOf(row) < from || dateOf(row) > until)) throw new Error("Treasury date outside requested range");
    return normalizeTreasury(series, rows);
  } catch (error) {
    const category = signal.aborted ? "timeout" : error instanceof TreasuryThrottle ? "throttled"
      : error instanceof PageError ? error.category : validating ? "validation" : "network";
    throw new TreasuryFailure(category, processed, Math.round(performance.now() - started),
      error instanceof TreasuryThrottle ? error.until : undefined, error instanceof Error ? error.message : undefined);
  }
}
