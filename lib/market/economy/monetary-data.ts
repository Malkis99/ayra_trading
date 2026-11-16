export const monetarySources = {
  policy: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm",
  yields: "https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics",
  dollar: "https://www.federalreserve.gov/releases/h10/summary/jrxwtfb_nb.htm",
} as const;

export const effectiveRateSource = "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json";
export const maturities = ["3M", "2Y", "5Y", "10Y", "30Y", "10Y − 2Y", "10Y − 3M"] as const;
export type MonetarySeries = keyof typeof monetarySources;
export type MonetaryPoint = { date: string; values: (number | null)[] };
export type MonetarySnapshot = {
  status: "ready" | "stale" | "unavailable" | "error";
  points: MonetaryPoint[];
  effectiveRate?: MonetaryPoint;
  releasedOn?: string;
  dollarChanges?: (number | null)[];
};

export const dayMs = 86_400_000;

export function dollarChanges(points: MonetaryPoint[]) {
  const latest = points.at(-1);
  return [1, 3, 12].map(months => {
    if (!latest?.values[0]) return null;
    const target = new Date(latest.date);
    const day = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() - months);
    const nextMonth = new Date(target);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 0);
    target.setUTCDate(Math.min(day, nextMonth.getUTCDate()));
    const cutoff = target.toISOString().slice(0, 10);
    const baseline = points.findLast(point => point.date <= cutoff && point.values[0] !== null);
    if (!baseline?.values[0] || +target - Date.parse(baseline.date) > 7 * dayMs) return null;
    return (latest.values[0] / baseline.values[0] - 1) * 100;
  });
}
