import type { EventResult } from "./types";
import { BLS_RELEASES } from "./schedules";

/**
 * The published figures of the main BLS releases, from the official BLS API (api.bls.gov). The site's own pages and
 * .ics refuse automated downloads; the API is the documented way for programs. Without a key: 25 requests a day
 * (v1); with a free registered key (`BLS_API_KEY`): 500 (v2). One request asks for every series at once, and only
 * around a release (see collect.ts), so a day never needs more than a few.
 */
export const BLS_API_V1 = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
export const BLS_API_V2 = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

export const BLS_SERIES = {
  payrolls: "CES0000000001", // total nonfarm employment, thousands, seasonally adjusted
  unemployment: "LNS14000000", // unemployment rate, %, s.a.
  cpi: "CUSR0000SA0", // CPI-U all items, index, s.a.
  ppi: "WPSFD4", // PPI final demand, index, s.a.
  jolts: "JTS000000000000000JOL", // job openings, thousands, s.a.
} as const;

type SeriesId = (typeof BLS_SERIES)[keyof typeof BLS_SERIES];
/** Newest first: period `2026-10` → value. */
export type SeriesValues = { period: string; value: number }[];

/** The API's answer → newest-first values per series (monthly periods only). */
export function parseBlsResponse(json: unknown): Map<string, SeriesValues> {
  const out = new Map<string, SeriesValues>();
  const series = (json as { Results?: { series?: { seriesID: string; data: { year: string; period: string; value: string }[] }[] } })?.Results?.series ?? [];
  for (const s of series) {
    const values = (s.data ?? [])
      .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && Number.isFinite(Number(d.value)))
      .map((d) => ({ period: `${d.year}-${d.period.slice(1)}`, value: Number(d.value) }))
      .sort((a, b) => (a.period < b.period ? 1 : -1));
    out.set(s.seriesID, values);
  }
  return out;
}

const signed = (n: number, digits: number, unit: string) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}${unit}`;
const monthOverMonth = (v: SeriesValues, i: number) => (v[i] && v[i + 1] ? (v[i].value / v[i + 1].value - 1) * 100 : null);

/** One figure and the one before, or null when the reference month is not in the API yet. */
function figure(code: keyof typeof BLS_RELEASES, ref: string, data: Map<string, SeriesValues>): { actual: string; previous: string | null } | null {
  const pick = (id: SeriesId) => data.get(id) ?? [];
  if (code === "us_nfp") {
    const v = pick(BLS_SERIES.payrolls);
    if (v[0]?.period !== ref || !v[1]) return null;
    const change = v[0].value - v[1].value;
    const before = v[2] ? v[1].value - v[2].value : null;
    const rate = pick(BLS_SERIES.unemployment).find((x) => x.period === ref);
    return { actual: `${signed(change, 0, "K")}${rate ? ` · ${rate.value.toFixed(1)}%` : ""}`, previous: before === null ? null : signed(before, 0, "K") };
  }
  if (code === "us_cpi" || code === "us_ppi") {
    const v = pick(code === "us_cpi" ? BLS_SERIES.cpi : BLS_SERIES.ppi);
    if (v[0]?.period !== ref) return null;
    const now = monthOverMonth(v, 0);
    const before = monthOverMonth(v, 1);
    return now === null ? null : { actual: signed(now, 1, "%"), previous: before === null ? null : signed(before, 1, "%") };
  }
  if (code === "us_jolts") {
    const v = pick(BLS_SERIES.jolts);
    if (v[0]?.period !== ref) return null;
    return { actual: `${(v[0].value / 1000).toFixed(2)}M`, previous: v[1] ? `${(v[1].value / 1000).toFixed(2)}M` : null };
  }
  return null; // ECI: quarterly, the status shows it is out but no figure is computed here
}

/** Figures for the given due events (`bls:<code>:<day>`) that the API already has. */
export function blsResults(dueIds: string[], data: Map<string, SeriesValues>): EventResult[] {
  const out: EventResult[] = [];
  for (const id of dueIds) {
    const [, code, day] = id.split(":") as [string, keyof typeof BLS_RELEASES, string];
    const ref = BLS_RELEASES[code]?.dates[day];
    if (!ref) continue;
    const f = figure(code, ref, data);
    if (f) out.push({ id, status: "released", actual: f.actual, previous: f.previous, summary: null });
  }
  return out;
}

export const blsRequestBody = (key: string | undefined, year: number) =>
  JSON.stringify({
    seriesid: Object.values(BLS_SERIES),
    startyear: String(year - 1),
    endyear: String(year),
    ...(key ? { registrationkey: key } : {}),
  });
