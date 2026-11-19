import { loadFundamental } from "./fundamentals-source";
import { fundamentalDefinitions, orderedObservations, type FundamentalSeries, type FundamentalSnapshot } from "./fundamentals-data";

type Entry = { data: FundamentalSnapshot; at: number };
const pending = new Map<string, Promise<FundamentalSnapshot>>();
const good = new Map<string, Entry>();
const retryAfter = new Map<string, number>();
const day = 86_400_000;

export function fundamentalSnapshot(series: FundamentalSeries, history: boolean): Promise<FundamentalSnapshot> {
  const key = series + ":" + history;
  const running = pending.get(key);
  if (running) return running;
  const now = Date.now();
  const prior = good.get(key);
  const fallback = (): FundamentalSnapshot => prior ? { ...prior.data, status: "stale" } : { status: "error", points: [] };
  if ((retryAfter.get(key) ?? 0) > now) return Promise.resolve(fallback());
  if (prior && now - prior.at < 60_000) return Promise.resolve(prior.data);
  const request = loadFundamental(series, history, now).then(result => {
    const points = orderedObservations(result.points, now);
    const latest = points[0];
    const cutoff = fundamentalDefinitions[series].frequency === "weekly" ? 28 : 70;
    const stale = latest && now - Date.parse(latest.publishedAt ?? (latest.period.length === 7 ? latest.period + "-01" : latest.period)) > cutoff * day;
    const data: FundamentalSnapshot = { status: !points.length ? "unavailable" : result.partial ? "partial" : stale ? "stale" : "ready",
      points: history ? points : points.slice(0, 1), retrievedAt: result.retrievedAt };
    if (prior && (result.retrievedAt < (prior.data.retrievedAt ?? "") || points.some(point => {
      const confirmed = prior.data.points.find(item => item.period === point.period);
      if (!confirmed) return false;
      const olderRelease = confirmed.publishedAt !== null &&
        (point.publishedAt === null || Date.parse(point.publishedAt) < Date.parse(confirmed.publishedAt));
      const olderReport = /^\d{4}-\d{2}-\d{2}$/.test(confirmed.vintage) && point.vintage < confirmed.vintage;
      const conflict = point.vintage === confirmed.vintage &&
        (point.value !== confirmed.value || point.previous !== confirmed.previous);
      return olderRelease || olderReport || conflict;
    }))) {
      console.warn(JSON.stringify({ event: "fundamentals_vintage_conflict", series, period: latest?.period }));
      return { ...prior.data, status: "stale" } as FundamentalSnapshot;
    }
    if (points.length && (!prior || latest.period >= prior.data.points[0].period)) good.set(key, { data, at: now });
    else if (points.length && prior) return { ...prior.data, status: "stale" } as FundamentalSnapshot;
    return data;
  }).catch(error => {
    retryAfter.set(key, Date.now() + 60_000);
    const category = error instanceof Error && /^[a-z_]+(?:_\d+)?$/.test(error.message) ? error.message : "network_or_timeout";
    console.warn(JSON.stringify({ event: "fundamentals_read_failed", series, history, category, durationMs: Date.now() - now }));
    return fallback();
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
