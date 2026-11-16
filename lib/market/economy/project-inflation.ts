import { CPI_METRICS, verifiedCpiMeta, type CpiCode } from "../feeds/cpi";
import type { EconomyCalendarRow } from "./project-calendar";

export const inflationCodes = Object.keys(CPI_METRICS) as CpiCode[];

function percent(raw: string | null) {
  if (!raw || !/^[+−-]?\d+\.\d%$/.test(raw)) return null;
  const value = Number(raw.slice(0, -1).replace("−", "-"));
  return Number.isFinite(value) ? value : null;
}

export function projectInflation(rows: EconomyCalendarRow[], now: number) {
  return Object.fromEntries(inflationCodes.map(code => {
    const periods = new Map<string, InflationObservation | null>();
    for (const row of rows) {
      const period = row.reference_period;
      const meta = row.result_meta;
      if (row.code !== code || row.country !== "us" || row.source !== "bls" || row.kind !== "release"
        || row.status !== "released" || row.release_stage !== "regular" || row.hidden || row.time_tbd || !period
        || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !verifiedCpiMeta(code, period, meta)) continue;
      const releasedAt = meta!.source_updated!;
      const sourceUrl = meta!.release_url!;
      const time = Date.parse(releasedAt);
      const date = new Date(time).toISOString().slice(0, 10);
      if (time > now || period >= date.slice(0, 7)
        || !sourceUrl.endsWith("/cpi_" + date.slice(5, 7) + date.slice(8) + date.slice(0, 4) + ".htm")) continue;
      const actual = percent(row.actual);
      if (actual === null) continue;
      periods.set(period, periods.has(period) ? null : { period, actual, previous: percent(row.previous), releasedAt, sourceUrl });
    }
    return [code, Array.from(periods.values()).filter((row): row is InflationObservation => row !== null)
      .sort((a, b) => b.period.localeCompare(a.period))];
  })) as Record<CpiCode, InflationObservation[]>;
}

export type InflationObservation = {
  period: string;
  actual: number;
  previous: number | null;
  releasedAt: string;
  sourceUrl: string;
};
