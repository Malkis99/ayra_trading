import type { ResultMeta } from "../feeds/types";

export const economyCodes = ["us_gdp", "us_nfp", "us_jobless_claims"] as const;
export type EconomyCode = typeof economyCodes[number];
export const economyColumns = "id,code,country,source,status,kind,hidden,time_tbd,starts_at,reference_period,release_stage,actual,previous,result_meta";
export type EconomyCalendarRow = {
  id: string;
  code: string;
  country: string;
  source: string;
  status: string;
  kind: string;
  hidden: boolean;
  time_tbd: boolean;
  starts_at: string;
  reference_period: string | null;
  release_stage: string | null;
  actual: string | null;
  previous: string | null;
  result_meta: ResultMeta | null;
};

const definitions = {
  us_gdp: { source: "bea", unit: "percent", adjustment: "official-release", series: "us_gdp",
    period: /^\d{4}-Q[1-4]$/, value: /^([+−-]?\d+(?:\.\d+)?)%$/, stages: ["advance", "second", "third"] },
  us_nfp: { source: "bls", unit: "thousand-change-and-percent", adjustment: "SA", series: "us_nfp",
    period: /^\d{4}-(0[1-9]|1[0-2])$/, value: /^([+−-]?\d+)K(?: · \d+(?:\.\d+)?%)?$/, stages: ["regular"] },
  us_jobless_claims: { source: "dol", unit: "thousand", adjustment: "SA", series: "initial-claims",
    period: /^\d{4}-\d{2}-\d{2}$/, value: /^(\d+(?:\.\d+)?)K$/, stages: ["regular"] },
};

const officialArchives: Record<EconomyCode, string> = {
  us_gdp: "https://www.bea.gov/news/archive",
  us_nfp: "https://www.bls.gov/bls/news-release/empsit.htm",
  us_jobless_claims: "https://oui.doleta.gov/unemploy/archive.asp",
};

// These links and release times were checked in the dated bulletins.
// Calendar dates and URL fields cannot establish a new entry in this list.
const verifiedReleases = {
  us_gdp: { id: "bea:us_gdp:2026-10-29", period: "2026-Q3", stage: "advance", releasedAt: "2026-10-29T12:30:00Z",
    url: "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026" },
  us_nfp: { id: "bls:us_nfp:2026-11-06", period: "2026-10", stage: "regular", releasedAt: "2026-11-06T13:30:00Z",
    url: "https://www.bls.gov/news.release/archives/empsit_11062026.htm" },
  us_jobless_claims: { id: "dol:us_jobless_claims:2026-11-12", period: "2026-11-07", stage: "regular", releasedAt: "2026-11-12T13:30:00Z",
    url: "https://oui.doleta.gov/press/2026/111226.pdf" },
} satisfies Record<EconomyCode, { id: string; period: string; stage: string; releasedAt: string; url: string }>;

export type Observation = {
  id: string;
  code: EconomyCode;
  period: string;
  stage: string;
  actual: number;
  previous: number | null;
  scheduledAt: string;
  releasedAt: string | null;
  sourceUpdatedAt: string | null;
  retrievedAt: string | null;
  sourceUrl: string;
  sourceKind: "release" | "archive";
  unemployment?: number;
};

function formatNumber(raw: string | null, pattern: RegExp): number | null {
  const match = raw?.match(pattern);
  if (!match) return null;
  const value = Number(match[1].replace("−", "-"));
  return Number.isFinite(value) ? value : null;
}

export function projectEconomy(rows: EconomyCalendarRow[], now: number): Record<EconomyCode, Observation[]> {
  const result: Record<EconomyCode, Observation[]> = { us_gdp: [], us_nfp: [], us_jobless_claims: [] };
  for (const code of economyCodes) {
    const definition = definitions[code];
    const observations = new Map<string, Observation[]>();
    for (const row of rows) {
      const meta = row.result_meta;
      const period = row.reference_period;
      const stage = row.release_stage;
      const start = Date.parse(row.starts_at);
      if (row.code !== code || row.country !== "us" || row.source !== definition.source || row.kind !== "release"
        || row.status !== "released" || row.hidden || row.time_tbd || !(start <= now)
        || !period || !definition.period.test(period) || !stage || !definition.stages.includes(stage)
        || meta?.period !== period || meta.series !== definition.series || meta.unit !== definition.unit
        || meta.adjustment !== definition.adjustment) continue;
      // DOL also writes revised figures to older events. Keep the initial weekly release series.
      // BEA RSS dates each stage. BLS API stores a current snapshot with no upstream update timestamp.
      if (code !== "us_nfp" && Date.parse(meta.source_updated ?? "") !== start) continue;
      const actual = formatNumber(row.actual, definition.value);
      if (actual === null) continue;
      const checked = verifiedReleases[code];
      const release = checked.id === row.id && checked.period === period && checked.stage === stage ? checked : null;
      const item: Observation = { id: row.id, code, period, stage, actual,
        previous: formatNumber(row.previous, code === "us_nfp" ? /^([+−-]?\d+)K$/ : definition.value),
        scheduledAt: row.starts_at, releasedAt: release?.releasedAt ?? null,
        // BEA and DOL use source_updated as release-version evidence. Receipt is not recorded.
        sourceUpdatedAt: null, retrievedAt: null,
        sourceUrl: release?.url ?? officialArchives[code], sourceKind: release ? "release" : "archive" };
      if (code === "us_nfp") {
        // The existing BLS batch attaches LNS14000000 only for the same monthly period.
        const rate = row.actual?.match(/^[+−-]?\d+K · (\d+(?:\.\d+)?)%$/);
        if (rate && Number(rate[1]) <= 100) item.unemployment = Number(rate[1]);
      }
      const key = period + ":" + stage;
      observations.set(key, [...(observations.get(key) ?? []), item]);
    }
    result[code] = [...observations.values()].filter(items => items.length === 1).map(([item]) => item)
      .sort((a, b) => b.period.localeCompare(a.period) || Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));
  }
  return result;
}

export const ranges = ["1", "3", "5", "10", "max"] as const;
export type HistoryRange = typeof ranges[number];

export function economyHistory(rows: Observation[], stage: string, range: HistoryRange, now: number) {
  const cutoff = new Date(now);
  if (range !== "max") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(range));
  return rows.filter(row => row.stage === stage && (range === "max" || Date.parse(row.scheduledAt) >= +cutoff)).reverse();
}

export function periodIndex(row: Observation) {
  const year = Number(row.period.slice(0, 4));
  if (row.code === "us_gdp") return year * 4 + Number(row.period.slice(-1));
  if (row.code === "us_nfp") return year * 12 + Number(row.period.slice(-2));
  return Date.parse(row.period) / (7 * 86_400_000);
}
