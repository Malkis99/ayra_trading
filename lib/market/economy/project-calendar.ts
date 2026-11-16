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

export type Observation = {
  id: string;
  code: EconomyCode;
  period: string;
  stage: string;
  actual: number;
  previous: number | null;
  scheduledAt: string;
  confirmedAt: string | null;
  sourceUrl: string;
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
      const day = new Date(start).toISOString().slice(0, 10).split("-");
      const sourceUrl = code === "us_nfp" ? `https://www.bls.gov/news.release/archives/empsit_${day[1]}${day[2]}${day[0]}.htm`
        : code === "us_gdp" ? "https://www.bea.gov/data/gdp/gross-domestic-product"
        : "https://oui.doleta.gov/unemploy/archive.asp";
      const item = { id: row.id, code, period, stage, actual,
        previous: formatNumber(row.previous, code === "us_nfp" ? /^([+−-]?\d+)K$/ : definition.value),
        scheduledAt: row.starts_at, confirmedAt: code === "us_nfp" ? null : row.starts_at, sourceUrl };
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
