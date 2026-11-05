import type { EventResult } from "./types";
import { CENSUS_RELEASES } from "./schedules-us";

/**
 * Census figures from its official API, the Economic Indicators time series (https://api.census.gov/data/timeseries/eits,
 * public domain). Data queries now require a free server-side API key (official EITS guidance, revised May 2026).
 * Successful live series validation is required before claiming coverage; documented fixtures are not live data.
 *
 * The answer is a table: the first row names the columns, e.g.
 *   [["cell_value","data_type_code","category_code","seasonally_adj","time","us"], ["0.4","MPCSM","44X72","yes","2026-10","1"], …]
 */
export const CENSUS_API = "https://api.census.gov/data/timeseries/eits";

type CensusCode = keyof typeof CENSUS_RELEASES;

/** Which series is the headline of each release. `change`: Census's own month-on-month percent change, if it gives one. */
export const CENSUS_SERIES: Record<CensusCode, { program: string; category: string; level: string; change: string | null; unit: "pct" | "millions" | "thousands" }> = {
  us_retail_sales: { program: "marts", category: "44X72", level: "SM", change: "MPCSM", unit: "pct" }, // retail and food services, sales
  us_durable_goods: { program: "advm3", category: "MDM", level: "NO", change: "MPCNO", unit: "pct" }, // durable goods, new orders
  us_housing_starts: { program: "resconst", category: "STARTS", level: "TOTAL", change: null, unit: "millions" }, // thousand units, annual rate
  us_new_home_sales: { program: "ressales", category: "SOLD", level: "TOTAL", change: null, unit: "thousands" }, // thousand units, annual rate
};

const monthsBefore = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** The months from three before the reference month: enough for this month's change and the one before. */
export function censusUrl(code: CensusCode, ref: string): string {
  const s = CENSUS_SERIES[code];
  const q = new URLSearchParams({ get: "cell_value,data_type_code,category_code,seasonally_adj", time: `from ${monthsBefore(ref, 3)} to ${ref}`, for: "us:*" });
  return `${CENSUS_API}/${s.program}?${q.toString()}`;
}

/** Seasonally adjusted values of one category: data type → month → value. */
export function parseCensus(json: unknown, category: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!Array.isArray(json) || !Array.isArray(json[0])) return out;
  const head = (json[0] as unknown[]).map(String);
  const col = (name: string) => head.indexOf(name);
  const [v, type, cat, sa, time] = ["cell_value", "data_type_code", "category_code", "seasonally_adj", "time"].map(col);
  if ([v, type, cat, sa, time].some((i) => i < 0)) return out;
  for (const row of json.slice(1) as unknown[][]) {
    if (!Array.isArray(row) || String(row[cat]) !== category) continue;
    if (String(row[sa]).toLowerCase() !== "yes" || !/^\d{4}-\d{2}$/.test(String(row[time]))) continue;
    const value = Number(String(row[v]).replace(/,/g, ""));
    if (!Number.isFinite(value) || String(row[v]).trim() === "") continue;
    const t = String(row[type]);
    if (!out.has(t)) out.set(t, new Map());
    out.get(t)!.set(String(row[time]), value);
  }
  return out;
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

/** The figure of one month as the calendar shows it (a percent change or a level), or null when it is not in. */
function figureOf(code: CensusCode, month: string, data: Map<string, Map<string, number>>): string | null {
  const s = CENSUS_SERIES[code];
  const level = data.get(s.level);
  if (s.unit === "pct") {
    const own = s.change ? data.get(s.change) : undefined;
    if (own?.has(month)) return signed(own.get(month)!);
    const a = level?.get(month);
    const b = level?.get(monthsBefore(month, 1));
    return a !== undefined && b ? signed((a / b - 1) * 100) : null;
  }
  const v = level?.get(month);
  if (v === undefined) return null;
  return s.unit === "millions" ? `${(v / 1000).toFixed(3)}M` : `${v}K`;
}

/** This month's figure and the month before's, or null until the API has the reference month. */
export function censusResult(id: string, data: Map<string, Map<string, number>>): EventResult | null {
  const [, code, day] = id.split(":") as [string, CensusCode, string];
  const ref = CENSUS_RELEASES[code]?.dates[day];
  if (!ref) return null;
  const actual = figureOf(code, ref, data);
  if (actual === null) return null;
  return { id, status: "released", actual, previous: figureOf(code, monthsBefore(ref, 1), data), summary: null };
}

/** The «previous» of the release covering `ref`: the figure of the month before. */
export function censusLatest(code: CensusCode, ref: string, data: Map<string, Map<string, number>>): string | null {
  return figureOf(code, monthsBefore(ref, 1), data);
}
