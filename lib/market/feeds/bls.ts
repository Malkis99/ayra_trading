import type { EventResult } from "./types";
import { BLS_RELEASES } from "./schedules";
import { previousPeriod } from "./identity";

/**
 * Current series for non-CPI BLS releases from the official API (api.bls.gov). CPI uses the dated release archive
 * (cpi.ts), because current seasonally adjusted indexes do not prove the original vintage. Without a key: 25 requests a day
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
      .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && d.value !== null && String(d.value).trim() !== "" && Number.isFinite(Number(d.value)))
      .map((d) => ({ period: `${d.year}-${d.period.slice(1)}`, value: Number(d.value) }))
      .sort((a, b) => (a.period < b.period ? 1 : -1));
    out.set(s.seriesID, values);
  }
  return out;
}

const signed = (n: number, digits: number, unit: string) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}${unit}`;
const monthOverMonth = (v: SeriesValues, i: number) => (v[i] && v[i + 1] && v[i + 1].period === previousPeriod(v[i].period) && v[i + 1].value !== 0 ? (v[i].value / v[i + 1].value - 1) * 100 : null);

/** The releases a figure is computed for (ECI is quarterly: the calendar shows it without a figure). */
export const BLS_FIGURE_CODES = ["us_nfp", "us_ppi", "us_jolts"] as const;

/**
 * The figure for a reference month and the month before, or null when that month is not in the API yet. Found by
 * the month, not as «the newest», so a release asked for days later (the collector's retries) still gets its own.
 */
function figure(code: keyof typeof BLS_RELEASES, ref: string, data: Map<string, SeriesValues>): { actual: string; previous: string | null } | null {
  const pick = (id: SeriesId) => data.get(id) ?? [];
  const at = (v: SeriesValues) => v.findIndex((x) => x.period === ref);
  if (code === "us_nfp") {
    const v = pick(BLS_SERIES.payrolls);
    const i = at(v);
    if (i < 0 || !v[i + 1] || v[i + 1].period !== previousPeriod(ref)) return null;
    const change = v[i].value - v[i + 1].value;
    const before = v[i + 2]?.period === previousPeriod(v[i + 1].period) ? v[i + 1].value - v[i + 2].value : null;
    const rate = pick(BLS_SERIES.unemployment).find((x) => x.period === ref);
    return { actual: `${signed(change, 0, "K")}${rate ? ` · ${rate.value.toFixed(1)}%` : ""}`, previous: before === null ? null : signed(before, 0, "K") };
  }
  if (code === "us_ppi") {
    const v = pick(BLS_SERIES.ppi);
    const i = at(v);
    if (i < 0) return null;
    const now = monthOverMonth(v, i);
    const before = monthOverMonth(v, i + 1);
    return now === null ? null : { actual: signed(now, 1, "%"), previous: before === null ? null : signed(before, 1, "%") };
  }
  if (code === "us_jolts") {
    const v = pick(BLS_SERIES.jolts);
    const i = at(v);
    if (i < 0) return null;
    return { actual: `${(v[i].value / 1000).toFixed(2)}M`, previous: v[i + 1]?.period === previousPeriod(ref) ? `${(v[i + 1].value / 1000).toFixed(2)}M` : null };
  }
  return null; // ECI: quarterly, the status shows it is out but no figure is computed here
}

/** The figure of each release's newest month in the API: the «previous» of its next release. */
export function blsLatest(data: Map<string, SeriesValues>, expected?: Record<string, string | null | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  const series: Record<(typeof BLS_FIGURE_CODES)[number], SeriesId> = { us_nfp: BLS_SERIES.payrolls, us_ppi: BLS_SERIES.ppi, us_jolts: BLS_SERIES.jolts };
  for (const code of BLS_FIGURE_CODES) {
    const ref = expected ? (expected[code] ? previousPeriod(expected[code]!) : null) : data.get(series[code])?.[0]?.period;
    const f = ref ? figure(code, ref, data) : null;
    if (f) out.set(code, f.actual);
  }
  return out;
}

/** Figures for the given due events (`bls:<code>:<day>`) that the API already has. */
export function blsResults(dueIds: string[], data: Map<string, SeriesValues>, contexts: { id: string; code: string | null; reference_period?: string | null }[] = []): EventResult[] {
  const out: EventResult[] = [];
  for (const id of dueIds) {
    const context = contexts.find((e) => e.id === id);
    const code = (context?.code || id.split(":")[1]) as keyof typeof BLS_RELEASES;
    const ref = context?.reference_period || BLS_RELEASES[code]?.dates[id.split(":")[2]];
    if (!ref) continue;
    const f = figure(code, ref, data);
    if (f) out.push({ id, status: "released", actual: f.actual, previous: f.previous, summary: null,
      result_meta: { period: ref, series: code, unit: code === "us_nfp" ? "thousand-change-and-percent" : code === "us_jolts" ? "million" : "percent-mom", adjustment: "SA" } });
  }
  return out;
}

export const blsRequestBody = (key: string | undefined, year: number) =>
  JSON.stringify({
    seriesid: Object.values(BLS_SERIES).filter(id => id !== BLS_SERIES.cpi),
    startyear: String(year - 1),
    endyear: String(year),
    ...(key ? { registrationkey: key } : {}),
  });
