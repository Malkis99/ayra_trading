export const fundamentalSeries = ["earnings", "unemployment", "continuing", "income", "consumption", "retail", "production"] as const;
export type FundamentalSeries = typeof fundamentalSeries[number];
export type FundamentalObservation = {
  period: string;
  value: number;
  previous: number | null;
  sourceUrl: string;
  publishedAt: string | null;
  vintage: string;
  stage: "current" | "preliminary" | "revised" | "initial";
};
export type FundamentalSnapshot = {
  status: "ready" | "partial" | "stale" | "unavailable" | "error";
  points: FundamentalObservation[];
  retrievedAt?: string;
  staleReason?: "source_check_expired" | "source_check_unconfirmed" | "observation_old" | "source_unavailable" | "provenance_conflict";
};
export const fundamentalDefinitions = {
  earnings: { group: "employment", seriesId: "CES0500000003", unit: "USD/hour", adjustment: "SA", frequency: "monthly",
    url: "https://api.bls.gov/publicAPI/v1/timeseries/data/CES0500000003" },
  unemployment: { group: "employment", seriesId: "LNS14000000", unit: "percent", adjustment: "SA", frequency: "monthly",
    url: "https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000" },
  continuing: { group: "claims", seriesId: "DOL-r539-ContinuedClaims-SA", unit: "persons", adjustment: "SA", frequency: "weekly",
    url: "https://oui.doleta.gov/unemploy/claims.asp" },
  income: { group: "bea", seriesId: "BEA-personal-income-mom", unit: "percent-mom", adjustment: "SA", frequency: "monthly",
    url: "https://www.bea.gov/data/income-saving/personal-income" },
  consumption: { group: "bea", seriesId: "BEA-current-dollar-PCE-mom", unit: "percent-mom", adjustment: "SA", frequency: "monthly",
    url: "https://www.bea.gov/data/consumer-spending/main" },
  retail: { group: "retail", seriesId: "Census-MARTS-44X72-mom", unit: "percent-mom", adjustment: "SA-calendar", frequency: "monthly",
    url: "https://www.census.gov/retail/sales.html" },
  production: { group: "production", seriesId: "Fed-G17-total-IP-mom", unit: "percent-mom", adjustment: "SA", frequency: "monthly",
    url: "https://www.federalreserve.gov/releases/g17/current/default.htm" },
} as const;

export function previousMonth(period: string) {
  const date = new Date(period + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

/** A response is one vintage. Conflicting copies of a period invalidate that series. */
export function orderedObservations(points: FundamentalObservation[], now: number) {
  if (points.some(point => !Number.isFinite(point.value) || (point.previous !== null && !Number.isFinite(point.previous))
    || !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(point.period)
    || !validPeriod(point.period, now)
    || (point.publishedAt !== null && !(Date.parse(point.publishedAt) <= now)))) throw new Error("unverified_observation");
  const seen = new Map<string, FundamentalObservation>();
  for (const point of points) {
    const prior = seen.get(point.period);
    if (prior && JSON.stringify(prior) !== JSON.stringify(point)) throw new Error("conflicting_period");
    seen.set(point.period, point);
  }
  return [...seen.values()].sort((a, b) => b.period.localeCompare(a.period));
}

function validPeriod(period: string, now: number) {
  const day = period.length === 7 ? period + "-01" : period;
  const date = new Date(day);
  return Number.isFinite(+date) && +date <= now && date.toISOString().slice(0, 10) === day;
}
