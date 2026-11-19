import { unstable_cache } from "next/cache";
import { beaEconomyRss, parsePceRelease, pceReleases, verifyBeaRelease, type PceObservation, type PceSnapshot } from "./bea-pce";
import { fetchFundamental } from "./fundamentals-http";

const recentAugust = {
  period: "2026-08",
  publishedAt: "2026-09-30T12:30:00.000Z",
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026",
};

async function read(url: string, type: string) {
  return fetchFundamental(url, type);
}

const cachedList = unstable_cache(async () => pceReleases(await read(beaEconomyRss, "xml"), Date.now()), ["bea-economy-feed-v1"], { revalidate: 3600 });
const cachedDocument = unstable_cache(async (release: Omit<PceObservation, "values">) => {
  const document = { html: await read(release.url, "text/html"), retrievedAt: new Date().toISOString() };
  verifyBeaRelease(document.html, release);
  return document;
}, ["bea-economy-document-v2"], { revalidate: 43_200 });
let listPending: ReturnType<typeof cachedList> | undefined;
const documentsPending = new Map<string, ReturnType<typeof cachedDocument>>();

export function beaReleaseList() {
  listPending ??= cachedList().finally(() => { listPending = undefined; });
  return listPending;
}
export function beaReleaseDocument(release: Omit<PceObservation, "values">) {
  const key = JSON.stringify(release);
  const current = documentsPending.get(key);
  if (current) return current;
  const request = cachedDocument(release).finally(() => documentsPending.delete(key));
  documentsPending.set(key, request);
  return request;
}
const fetchRelease = unstable_cache(async (release: Omit<PceObservation, "values">) =>
  parsePceRelease((await beaReleaseDocument(release)).html, release), ["bea-pce-release-v1"], { revalidate: 43_200 });

let lastKnown: PceObservation | undefined;

export async function pceSnapshot(history: boolean): Promise<PceSnapshot> {
  let releases: Omit<PceObservation, "values">[];
  try {
    releases = await beaReleaseList();
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
