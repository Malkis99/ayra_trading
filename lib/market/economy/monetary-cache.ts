import { unstable_cache } from "next/cache";
import { dayMs, monetarySources, type MonetarySeries, type MonetarySnapshot } from "./monetary-data";
import { loadMonetary, MonetaryFailure } from "./monetary";

type Data = Omit<MonetarySnapshot, "status">;
type Entry = { data: Data; checkedAt: number };
const inflight = new Map<string, Promise<Entry>>();
const pausedUntil = new Map<MonetarySeries, number>();
const lastGood = new Map<string, Entry>();

function refresh(series: MonetarySeries, history: boolean) {
  const key = series + ":" + history;
  const existing = inflight.get(key);
  if (existing) return existing;
  const checkedAt = Date.now();
  if ((pausedUntil.get(series) ?? 0) > checkedAt) throw new MonetaryFailure("cooldown");
  const result = loadMonetary(series, history, new Date(checkedAt).toISOString().slice(0, 10)).then(data => {
    if (!data.points.length) throw new MonetaryFailure("empty");
    return { data, checkedAt };
  }).catch(error => {
    const retryAt = error instanceof MonetaryFailure ? error.retryAt : undefined;
    pausedUntil.set(series, Math.max(checkedAt + 60_000, retryAt || 0, pausedUntil.get(series) ?? 0));
    console.warn(JSON.stringify({ event: "monetary_read_failed", series, history,
      category: error instanceof MonetaryFailure ? error.message : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "invalid_or_network",
      durationMs: Date.now() - checkedAt }));
    throw error;
  }).finally(() => inflight.delete(key));
  inflight.set(key, result);
  return result;
}

const readers = Object.fromEntries((Object.keys(monetarySources) as MonetarySeries[]).flatMap(series =>
  [false, true].map(history => [series + ":" + history,
    unstable_cache(() => refresh(series, history), ["market-monetary-v1", series, String(history)], { revalidate: history ? 43200 : 3600 })])));

export async function monetarySnapshot(series: MonetarySeries, history: boolean): Promise<MonetarySnapshot> {
  const key = series + ":" + history;
  try {
    const entry = await readers[key]();
    lastGood.set(key, entry);
    const freshnessDate = entry.data.points.at(-1)?.date;
    const stale = Date.now() - entry.checkedAt > dayMs || (series !== "policy" && freshnessDate
      && Date.now() - Date.parse(freshnessDate) > (series === "dollar" ? 12 : 7) * dayMs);
    return { ...entry.data, status: stale ? "stale" : "ready" };
  } catch (error) {
    const prior = lastGood.get(key);
    if (prior) return { ...prior.data, status: "stale" };
    return { status: error instanceof MonetaryFailure && error.message === "empty" ? "unavailable" : "error", points: [] };
  }
}
