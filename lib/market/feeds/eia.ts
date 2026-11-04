import type { EventResult } from "./types";
import { weekEnding } from "./schedules-us";

/**
 * EIA's weekly figures from its official API v2 (https://www.eia.gov/opendata/): free, needs a registered key
 * (`EIA_API_KEY`, in the URL as EIA asks). Public domain; EIA asks for the credit «Source: U.S. Energy Information
 * Administration». EIA's FAQ: the weekly reports reach the API «within two hours», so the collector asks for up to
 * three hours after a release. Limits: «sustained rate less than ~9,000 per hour and … burst rate beneath 5 per
 * second»; the collector asks at most every ten minutes.
 */
export const EIA_API = "https://api.eia.gov/v2";

export const EIA_SERIES = {
  /** U.S. ending stocks of crude oil excluding the SPR, thousand barrels */
  us_eia_crude: { route: "petroleum/stoc/wstk", series: "WCESTUS1" },
  /** Lower 48 working gas in underground storage, Bcf */
  us_eia_gas: { route: "natural-gas/stor/wkly", series: "NW2_EPG0_SWO_R48_BCF" },
} as const;
export type EiaCode = keyof typeof EIA_SERIES;

/** The newest three weeks of a series (enough for this week's change and the one before). */
export function eiaUrl(code: EiaCode, key: string): string {
  const s = EIA_SERIES[code];
  const q = new URLSearchParams({ api_key: key, frequency: "weekly", "data[0]": "value", "facets[series][]": s.series, "sort[0][column]": "period", "sort[0][direction]": "desc", length: "3" });
  return `${EIA_API}/${s.route}/data/?${q.toString()}`;
}

/** The API's answer → newest-first `{ period, value }`. */
export function parseEia(json: unknown): { period: string; value: number }[] {
  const data = (json as { response?: { data?: { period?: string; value?: string | number | null }[] } })?.response?.data ?? [];
  return data
    .map((d) => ({ period: String(d.period ?? ""), value: Number(d.value) }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.period) && d.value !== null && Number.isFinite(d.value))
    .sort((a, b) => (a.period < b.period ? 1 : -1));
}

const signed = (n: number, digits: number, unit: string) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}${unit}`;

/**
 * The week's change and the week before's: crude in million barrels (`−1.9M`), gas in Bcf (`+56 Bcf`). Null until the
 * API has the week the release covers.
 */
export function eiaResult(id: string, values: { period: string; value: number }[]): EventResult | null {
  const [, code, day] = id.split(":") as [string, EiaCode, string];
  if (!EIA_SERIES[code]) return null;
  const [now, before, older] = values;
  if (!now || !before || now.period !== weekEnding(day)) return null;
  const fmt = (n: number) => (code === "us_eia_crude" ? signed(n / 1000, 1, "M") : signed(n, 0, " Bcf"));
  return { id, status: "released", actual: fmt(now.value - before.value), previous: older ? fmt(before.value - older.value) : null, summary: null };
}
