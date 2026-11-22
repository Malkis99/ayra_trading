import { unstable_cache } from "next/cache";
import { beaReleaseDocument, beaReleaseList } from "./bea-cache";
import { fundamentalDefinitions, type FundamentalObservation, type FundamentalSeries } from "./fundamentals-data";
import { parseContinuing, parseEmployment, parsePersonal, parseProduction, parseRetail } from "./fundamentals-parsers";

export { fetchFundamental, FundamentalFailure } from "./fundamentals-http";
import { fetchFundamental, FundamentalFailure } from "./fundamentals-http";
type Document = { body: string; retrievedAt: string };
const pending = new Map<string, Promise<Document>>();

async function read(url: string, type: string, validate: (body: string) => void, body?: string) {
  const key = url + ":" + (body ?? "");
  const current = pending.get(key);
  if (current) return current;
  const request = unstable_cache(async () => {
    const document = { body: await fetchFundamental(url, type, body), retrievedAt: new Date().toISOString() };
    validate(document.body);
    return document;
  },
    ["fundamentals-document-v1", url, body ?? ""], { revalidate: url.includes("api.bls.gov") ? 43_200 : 3600 })()
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export async function loadFundamental(series: FundamentalSeries, history: boolean, now: number): Promise<{
  points: FundamentalObservation[]; partial?: boolean; retrievedAt: string;
}> {
  const url = fundamentalDefinitions[series].url;
  if (series === "earnings" || series === "unemployment") {
    const document = await read(url, "json", body => { parseEmployment(JSON.parse(body), series); });
    return { points: parseEmployment(JSON.parse(document.body), series), retrievedAt: document.retrievedAt };
  }
  if (series === "continuing") {
    const year = new Date(now).getUTCFullYear();
    // In early January the newest published week can still belong to the previous year.
    const body = new URLSearchParams({ level: "us", strtdate: String(history ? year - 2 : year - 1), enddate: String(year), filetype: "xml" });
    const document = await read("https://oui.doleta.gov/unemploy/wkclaims/report.asp", "xml", parseContinuing, body.toString());
    const points = parseContinuing(document.body);
    if (points.some(point => Date.parse(point.vintage) > now)) throw new FundamentalFailure("future_report");
    return { points, retrievedAt: document.retrievedAt };
  }
  if (series === "income" || series === "consumption") {
    const releases = await beaReleaseList();
    const candidates = history ? releases.slice(0, 3) : releases.slice(0, 1);
    // Same verified extra release as the existing PCE history, absent from BEA RSS.
    if (history && now >= Date.parse("2026-09-30T12:30:00Z") && !candidates.some(item => item.period === "2026-08")) {
      candidates.push({ period: "2026-08", publishedAt: "2026-09-30T12:30:00.000Z",
        url: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026" });
    }
    const points: FundamentalObservation[] = [];
    let partial = false;
    let retrievedAt: string | undefined;
    for (const release of candidates) {
      try {
        const document = await beaReleaseDocument(release);
        points.push(parsePersonal(document.html, release, series));
        if (!retrievedAt || document.retrievedAt < retrievedAt) retrievedAt = document.retrievedAt;
      }
      catch {
        partial = true;
        console.warn(JSON.stringify({ event: "fundamental_release_unverified", series, period: release.period }));
      }
    }
    if (candidates.length && !points.length) throw new FundamentalFailure("no_verified_releases");
    return { points, partial, retrievedAt: retrievedAt ?? new Date(now).toISOString() };
  }
  const parse = series === "retail" ? parseRetail : parseProduction;
  const document = await read(url, "text/html", parse);
  return { points: parse(document.body), retrievedAt: document.retrievedAt };
}
