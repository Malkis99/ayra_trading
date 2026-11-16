import { unstable_cache } from "next/cache";
import { fiscalRanges, fiscalSources, type FiscalData, type FiscalPoint, type FiscalRange, type FiscalSeries, type FiscalSnapshot } from "./fiscal-data";
import { loadTreasury, TreasuryFailure } from "./treasury";

const day = 86_400_000;
const seriesList = Object.keys(fiscalSources) as FiscalSeries[];
type Snapshot = { checkedAt: string; points: FiscalPoint[] };
type CacheKey = `${FiscalSeries}:${FiscalRange}`;
const retries: Partial<Record<CacheKey, number>> = {};
const running: Partial<Record<CacheKey, Promise<Snapshot>>> = {};
let sourcePauseUntil = 0;

function refresh(series: FiscalSeries, range: FiscalRange) {
  const key: CacheKey = `${series}:${range}`;
  return running[key] ??= (async () => {
    const now = Date.now();
    if (Math.max(sourcePauseUntil, retries[key] ?? 0) > now) throw new Error("Treasury cooldown");
    try {
      const points = await loadTreasury(series, new Date(now).toISOString().slice(0, 10), fetch, range);
      return { checkedAt: new Date().toISOString(), points };
    } catch (error) {
      const failure = error instanceof TreasuryFailure ? error : null;
      if (failure?.retryAt) sourcePauseUntil = Math.max(sourcePauseUntil, failure.retryAt);
      retries[key] = Date.now() + 60_000;
      console.warn(JSON.stringify({ event: "treasury_read_failed", series, range, category: failure?.category ?? "unknown",
        pages: failure?.pages ?? 0, durationMs: failure?.durationMs ?? Date.now() - now }));
      throw error;
    }
  })().finally(() => { delete running[key]; });
}

const snapshots = new Map(seriesList.flatMap(series => fiscalRanges.map(range => [
  `${series}:${range}`,
  unstable_cache(() => refresh(series, range), ["treasury-v2", series, range], { revalidate: range === "latest" ? 3600 : 43200 }),
] as const)));

export function treasuryStatus(series: FiscalSeries, snapshot: Snapshot, now: number): FiscalSnapshot {
  const latest = snapshot.points[snapshot.points.length - 1];
  const stale = !!latest && (now - Date.parse(snapshot.checkedAt) > day || now - Date.parse(latest.date) > (series === "debt" ? 7 : 55) * day);
  return { ...snapshot, status: stale ? "stale" : latest ? "ready" : "empty" };
}

export async function fiscalSeries(series: FiscalSeries, range: FiscalRange): Promise<FiscalSnapshot> {
  try {
    return treasuryStatus(series, await snapshots.get(`${series}:${range}`)!(), Date.now());
  } catch {
    return { status: "error", points: [] };
  }
}

/** Older clients still receive the three current snapshots, never a blocking historical read. */
export async function fiscalData(): Promise<FiscalData> {
  const [debt, budget, interest] = await Promise.all(seriesList.map(series => fiscalSeries(series, "latest")));
  return { debt, budget, interest };
}
