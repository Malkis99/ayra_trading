import { fundamentalDefinitions, type FundamentalSeries, type FundamentalSnapshot } from "./fundamentals-data";

/** Match the underlying document TTL, without a grace period for failed SWR. */
export function sourceCheckTtlSeconds(series: FundamentalSeries) {
  return ["earnings", "unemployment", "income", "consumption"].includes(series) ? 43_200 : 3600;
}

export function sourceCheckRemainingSeconds(series: FundamentalSeries, retrievedAt: string | undefined, now: number) {
  const timestamp = retrievedAt ? Date.parse(retrievedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now) return 0;
  return Math.max(0, Math.floor((timestamp + sourceCheckTtlSeconds(series) * 1000 - now) / 1000));
}

/** Reassess even an in-process cache hit: its source-check deadline has not moved. */
export function withFundamentalFreshness(series: FundamentalSeries, snapshot: FundamentalSnapshot, now: number): FundamentalSnapshot {
  if (!snapshot.points.length) return snapshot;
  const timestamp = snapshot.retrievedAt ? Date.parse(snapshot.retrievedAt) : NaN;
  const sourceReason = !Number.isFinite(timestamp) || timestamp > now ? "source_check_unconfirmed"
    : now - timestamp >= sourceCheckTtlSeconds(series) * 1000 ? "source_check_expired" : undefined;
  const latest = snapshot.points[0];
  const cutoff = fundamentalDefinitions[series].frequency === "weekly" ? 28 : 70;
  const observationOld = now - Date.parse(latest.publishedAt ?? (latest.period.length === 7 ? latest.period + "-01" : latest.period)) > cutoff * 86_400_000;
  const staleReason = sourceReason ?? (observationOld ? "observation_old" : undefined);
  return staleReason ? { ...snapshot, status: "stale", staleReason } : snapshot;
}
