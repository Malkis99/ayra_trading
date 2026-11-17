import { unstable_cache } from "next/cache";
import { beaEconomyRss, parsePceRelease, pceReleases, type PceObservation, type PceSnapshot } from "./bea-pce";

const recentAugust = {
  period: "2026-08",
  publishedAt: "2026-09-30T12:30:00.000Z",
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026",
};

async function read(url: string, type: string) {
  const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error("http_" + response.status);
  if (!response.headers.get("content-type")?.includes(type)) throw new Error("unexpected_media_type");
  return response.text();
}

const releaseList = unstable_cache(async () => pceReleases(await read(beaEconomyRss, "xml"), Date.now()), ["bea-economy-feed-v1"], { revalidate: 3600 });
const fetchRelease = unstable_cache(async (release: Omit<PceObservation, "values">) =>
  parsePceRelease(await read(release.url, "text/html"), release), ["bea-pce-release-v1"], { revalidate: 43_200 });

let lastKnown: PceObservation | undefined;

export async function pceSnapshot(history: boolean): Promise<PceSnapshot> {
  let releases: Omit<PceObservation, "values">[];
  try {
    releases = await releaseList();
  } catch {
    console.warn(JSON.stringify({ event: "bea_pce_read_failed", stage: "feed" }));
    return lastKnown ? { status: "stale", points: [lastKnown] } : { status: "error", points: [] };
  }
  const latest = releases[0];
  if (!latest) return { status: "unavailable", points: [] };
  let points: PceObservation[] = [];
  let failed = false;
  const candidates = history
    ? [...new Map([...releases.slice(0, 3), recentAugust].filter(release => Date.parse(release.publishedAt) <= Date.now()).map(release => [release.url, release])).values()]
    : [latest];
  for (const release of candidates) {
    try {
      points.push(await fetchRelease(release));
    } catch (error) {
      failed = true;
      const category = error instanceof Error && /^(http_\d+|pce_\w+|unexpected_media_type)$/.test(error.message) ? error.message : "network_or_timeout";
      console.warn(JSON.stringify({ event: "bea_pce_read_failed", stage: "release", period: release.period, category }));
    }
  }
  points = points.sort((a, b) => b.period.localeCompare(a.period));
  const verifiedLatest = points.find(point => point.url === latest.url);
  if (verifiedLatest && (!lastKnown || verifiedLatest.publishedAt >= lastKnown.publishedAt)) lastKnown = verifiedLatest;
  if (!points.length) return lastKnown ? { status: "stale", points: [lastKnown] } : { status: "error", points };
  const stale = Date.now() - Date.parse(points[0].publishedAt) > 50 * 86_400_000;
  return { points, status: failed ? "partial" : stale ? "stale" : "ready" };
}
