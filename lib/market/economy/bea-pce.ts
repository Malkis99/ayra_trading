import { blocks, link, plainText, text } from "../feeds/xml";
import { wallToUtc, NEW_YORK } from "../feeds/time";

const months = "January February March April May June July August September October November December".split(" ");
const prefix = "https://www.bea.gov/news/";
export const beaEconomyRss = "https://apps.bea.gov/rss/rss.xml";
type PceRelease = { period: string; publishedAt: string; url: string };
export type PceObservation = PceRelease & { vintageId?: string; values: [number, number, number, number] };
export type PceSnapshot = { status: "ready" | "stale" | "partial" | "error" | "unavailable"; points: PceObservation[] };

function period(month: string, year: string) {
  const index = months.indexOf(month);
  return index < 0 ? null : year + "-" + String(index + 1).padStart(2, "0");
}

export function pceReleases(xml: string, now: number) {
  return blocks(xml, "item").flatMap(item => {
    const match = text(item, "title")?.match(/^Personal Income and Outlays, ([A-Z][a-z]+) (\d{4})$/);
    const url = link(item);
    if (!match || !url) return [];
    const reference = period(match[1], match[2]);
    const publishedAt = Date.parse(text(item, "pubDate") ?? "");
    const slug = "personal-income-and-outlays-" + match[1].toLowerCase() + "-" + match[2];
    if (!reference || !Number.isFinite(publishedAt) || publishedAt > now || !url.startsWith(prefix)
      || !/^https:\/\/www\.bea\.gov\/news\/\d{4}\/[a-z0-9-]+$/.test(url) || !url.endsWith("/" + slug)) return [];
    return [{ period: reference, publishedAt: new Date(publishedAt).toISOString(), url }];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function uniqueChange(body: string, introduction: string): [number, number] {
  const rate = "(increased|decreased) (\\d+\\.\\d+) percent";
  const pattern = new RegExp(introduction + rate + "\\s*\\. Excluding food and energy, the PCE price index (?:also )?" + rate
    + "(?: from one year ago)?\\s*\\.", "g");
  const matches = [...body.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("pce_change_unverified");
  const [, a, b, c, d] = matches[0];
  return [(a === "decreased" ? -1 : 1) * Number(b), (c === "decreased" ? -1 : 1) * Number(d)];
}

export function parsePceRelease(html: string, release: PceRelease): PceObservation {
  const body = plainText(html);
  const embargo = body.match(/EMBARGOED UNTIL RELEASE AT 8:30 a\.m\. E[DS]T, [A-Za-z]+, ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  const title = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(hit => plainText(hit[1]))
    .map(value => value.match(/^Personal Income and Outlays, ([A-Za-z]+) (\d{4})$/)).find(Boolean);
  const publishedMonth = embargo && period(embargo[1], embargo[3]);
  if (!title || !embargo || !publishedMonth || period(title[1], title[2]) !== release.period
    || release.period >= publishedMonth || /\b(?:corrected release|reissued release)\b/i.test(body)) throw new Error("pce_vintage_unverified");
  const day = publishedMonth + "-" + embargo[2].padStart(2, "0");
  if (wallToUtc(day, "08:30", NEW_YORK) !== Date.parse(release.publishedAt)) throw new Error("pce_date_mismatch");
  const mo = uniqueChange(body, "From the preceding month, the PCE price index for " + title[1] + " ");
  const yo = uniqueChange(body, "From the same month one year ago, the PCE price index for " + title[1] + " ");
  const id = body.match(/\bBEA\s+(\d{2})\s*[-–—]\s*(\d+)\b/);
  return { ...release, ...(id ? { vintageId: "BEA " + id[1] + "-" + id[2] } : {}), values: [mo[0], yo[0], mo[1], yo[1]] };
}
