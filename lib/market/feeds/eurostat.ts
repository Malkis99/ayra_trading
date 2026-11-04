import type { EventResult, EventRow, Importance } from "./types";
import { parseIcsDays } from "./ics";
import { isoUtc, wallToUtc } from "./time";

/**
 * Eurostat (docs/market-feeds-plan.md, section 9, PR 2): the euro area's main releases.
 *
 * - Dates: Eurostat's own release calendar as iCal, category «Euro indicator release»
 *   (https://ec.europa.eu/eurostat/web/main/subscribe/ics.format, the URL its «Copy calendar URL» button makes).
 *   The entries give the day only. Euro indicators come out at 11:00 Luxembourg time: the times of Eurostat's own
 *   Euro indicators feed (e.g. «Euro area unemployment at 6.5%», published 2026-10-30T10:00:00Z = 11:00 CET;
 *   «Production in construction», 2026-10-20T09:00:00Z = 11:00 CEST). «This calendar uses Europe/Luxembourg time
 *   zone (CET/CEST).»
 * - Figures: Eurostat's dissemination API (JSON-stat 2.0, no key, «free of charge programmatic access»).
 * - Licence (https://ec.europa.eu/eurostat/help/copyright-notice): reuse «for commercial or non-commercial purposes is
 *   authorised provided the source is acknowledged» — every row names Eurostat and links to it, the calendar's
 *   footnote says «Source: Eurostat».
 */
export const EUROSTAT_ICS = "https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=2";
export const EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
export const EUROSTAT_PAGE = "https://ec.europa.eu/eurostat/news/euro-indicators";
export const LUXEMBOURG = "Europe/Luxembourg";
const RELEASE_TIME = "11:00";

export type EurostatCode = "eu_hicp_flash" | "eu_gdp_prelim" | "eu_gdp_flash" | "eu_unemployment" | "eu_retail_sales";

/** Which calendar entries we show (by Eurostat's own title) and how important they are. */
const RELEASES: { code: EurostatCode; title: RegExp; importance: Importance }[] = [
  { code: "eu_hicp_flash", title: /^Flash estimate inflation euro area$/i, importance: 3 },
  { code: "eu_gdp_prelim", title: /^Preliminary flash estimate GDP\b/i, importance: 3 },
  { code: "eu_gdp_flash", title: /^Flash estimate GDP and employment\b/i, importance: 2 },
  { code: "eu_unemployment", title: /^Unemployment$/i, importance: 2 },
  { code: "eu_retail_sales", title: /^Retail trade$/i, importance: 2 },
];

/** The calendar → rows of the releases we show, from `now` minus a week on (older ones are already stored). */
export function eurostatSchedule(ics: string, now: number): EventRow[] {
  const from = now - 7 * 86_400_000;
  const rows: EventRow[] = [];
  const seen = new Set<string>();
  for (const e of parseIcsDays(ics)) {
    const r = RELEASES.find((x) => x.title.test(e.summary));
    if (!r) continue;
    const at = wallToUtc(e.day, RELEASE_TIME, LUXEMBOURG);
    const id = `eurostat:${r.code}:${e.day}`;
    if (at < from || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, source: "eurostat", kind: "release", code: r.code, country: "eu", title: e.summary, importance: r.importance, starts_at: isoUtc(at), time_tbd: false, url: EUROSTAT_PAGE });
  }
  return rows;
}

/**
 * The headline series of each release. Euro area: `EA` (the evolving composition) where the dataset has it, otherwise
 * today's `EA21`. HICP moved to ECOICOP ver.2 in 2026 (`prc_hicp_minr`; the old `prc_hicp_manr` stops at 2025-12).
 */
export const EUROSTAT_SERIES: Record<EurostatCode, { dataset: string; filters: Record<string, string>; signed: boolean }> = {
  eu_hicp_flash: { dataset: "prc_hicp_minr", filters: { unit: "RCH_A", coicop18: "TOTAL" }, signed: false }, // annual inflation, %
  eu_gdp_prelim: { dataset: "namq_10_gdp", filters: { unit: "CLV_PCH_PRE", s_adj: "SCA", na_item: "B1GQ" }, signed: true }, // q/q, %
  eu_gdp_flash: { dataset: "namq_10_gdp", filters: { unit: "CLV_PCH_PRE", s_adj: "SCA", na_item: "B1GQ" }, signed: true },
  eu_unemployment: { dataset: "une_rt_m", filters: { s_adj: "SA", age: "TOTAL", sex: "T", unit: "PC_ACT" }, signed: false }, // % of labour force
  eu_retail_sales: { dataset: "sts_trtu_m", filters: { indic_bt: "VOL_SLS", nace_r2: "G47", s_adj: "SCA", unit: "PCH_PRE" }, signed: true }, // volume, m/m, %
};
const GEOS = ["EA", "EA21"];

export function eurostatUrl(code: EurostatCode): string {
  const s = EUROSTAT_SERIES[code];
  const q = new URLSearchParams({ format: "JSON", lang: "EN", lastTimePeriod: "3", ...s.filters });
  for (const g of GEOS) q.append("geo", g);
  return `${EUROSTAT_API}/${s.dataset}?${q.toString()}`;
}

interface JsonStat {
  id?: string[];
  size?: number[];
  value?: Record<string, number | null> | (number | null)[];
  updated?: string;
  dimension?: Record<string, { category?: { index?: Record<string, number> } }>;
}

export interface EurostatData {
  /** when the dataset was last updated, ms */
  updated: number | null;
  /** the newest period the dataset has for any country */
  latest: string | null;
  /** newest-first values of the first euro area code it has */
  values: { period: string; value: number }[];
}

/** The answer → when the dataset was updated, its newest period, and the euro area's values. */
export function parseEurostat(json: unknown): EurostatData {
  const j = json as JsonStat;
  const ids = j?.id ?? [];
  const sizes = j?.size ?? [];
  const updated = j?.updated ? Date.parse(j.updated) : null;
  const empty: EurostatData = { updated: updated !== null && Number.isFinite(updated) ? updated : null, latest: null, values: [] };
  if (!ids.length || ids.length !== sizes.length || !j.dimension || !j.value) return empty;
  const strides = ids.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1));
  const indexOf = (dim: string) => j.dimension?.[dim]?.category?.index ?? {};
  const value = (flat: number) => {
    const v = Array.isArray(j.value) ? j.value[flat] : j.value?.[String(flat)];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const times = Object.entries(indexOf("time")).sort((a, b) => b[1] - a[1]);
  empty.latest = times[0]?.[0] ?? null;
  for (const geo of GEOS) {
    const gi = indexOf("geo")[geo];
    if (gi === undefined) continue;
    const values: { period: string; value: number }[] = [];
    for (const [period, ti] of times) {
      // every other dimension has one value (the filters), so its index is 0
      const flat = ids.reduce((sum, dim, i) => sum + (dim === "geo" ? gi : dim === "time" ? ti : 0) * strides[i], 0);
      const v = value(flat);
      if (v !== null) values.push({ period, value: v });
    }
    if (values.length) return { ...empty, values };
  }
  return empty;
}

const fmt = (n: number, signed: boolean) => `${signed && n >= 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;

/**
 * The release's figure: the euro area's value for the dataset's newest period, once the dataset was updated at or
 * after the release (Eurostat updates the API at 11:00 with the release), and the period before. Null while the
 * dataset still has the old data, or the newest period has some countries but not the euro area yet.
 */
export function eurostatResult(id: string, startsAt: string, data: EurostatData): EventResult | null {
  const code = id.split(":")[1] as EurostatCode;
  const s = EUROSTAT_SERIES[code];
  if (!s || data.updated === null || data.updated < Date.parse(startsAt) - 60_000) return null;
  const [now, before] = data.values;
  if (!now || now.period !== data.latest) return null;
  return { id, status: "released", actual: fmt(now.value, s.signed), previous: before ? fmt(before.value, s.signed) : null, summary: null };
}
