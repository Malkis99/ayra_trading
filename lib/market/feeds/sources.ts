import type { EventResult, EventRow, Importance, NewsKind, NewsRow } from "./types";
import { blocks, link, plainText, raw, text, texts } from "./xml";
import { isoUtc, nyDay, parseFeedDate, utcDay } from "./time";
import { parseIcs } from "./ics";
import { FOMC_DECISIONS } from "./schedules";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The minutes come out three weeks after the decision: find that meeting. */
const minutesEvent = (day: string) => {
  const decision = FOMC_DECISIONS.find((d) => addDays(d, 21) === day);
  return decision ? `fed:fomc:${decision}:minutes` : null;
};

/**
 * The official sources (docs/market-feeds-plan.md, sections 2 and 5): what each feed is, and how its items become
 * calendar events and news. Pure functions — the network is in `collect.ts`. Importance and the noise filter live
 * here, in one place, so the owner's corrections are one small change.
 */

/** People whose words move the market most (update when they change). Read from the feeds 2026-11-03. */
export const FED_CHAIR = "Warsh"; // gave the latest «Semiannual Monetary Policy Report to the Congress»
export const ECB_PRESIDENT = "Lagarde";

export const FEEDS = {
  fedMonetary: "https://www.federalreserve.gov/feeds/press_monetary.xml",
  fedSpeeches: "https://www.federalreserve.gov/feeds/speeches.xml",
  fedTestimony: "https://www.federalreserve.gov/feeds/testimony.xml",
  ecbPress: "https://www.ecb.europa.eu/rss/press.html",
  whActions: "https://www.whitehouse.gov/presidential-actions/feed/",
  whNews: "https://www.whitehouse.gov/news/feed/",
  beaRss: "https://apps.bea.gov/rss/rss.xml",
  beaIcs: "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics",
} as const;

const MAX_SUMMARY = 1000;
const clip = (s: string | null, n = MAX_SUMMARY) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const clipTitle = (s: string) => (s.length > 300 ? `${s.slice(0, 299)}…` : s);

/** `Federal Reserve issues FOMC statement` → `federal-reserve-issues-fomc-statement`. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** One story told twice (two Fed feeds, a decision and its statement) shares this key and shows once. */
export const dedupeKey = (source: string, title: string, ms: number) => `${source}:${slug(title)}:${utcDay(ms)}`;

/** https only; the ECB writes `//press`, BEA sometimes drops the scheme. */
export function cleanUrl(u: string | null): string | null {
  if (!u) return null;
  let s = u.trim();
  if (/^www\./i.test(s)) s = `https://${s}`;
  s = s.replace(/^http:\/\//i, "https://");
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    const out = url.toString();
    return out.length <= 600 ? out : null;
  } catch {
    return null;
  }
}

interface FeedItem {
  title: string;
  url: string;
  ms: number;
  description: string | null;
  categories: string[];
  guid: string | null;
}

/** RSS items with a title, an https link and a date; the rest is dropped. */
export function feedItems(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const b of blocks(xml, "item")) {
    const title = text(b, "title");
    const url = cleanUrl(link(b));
    const ms = parseFeedDate(text(b, "pubDate"));
    if (!title || !url || ms === null) continue;
    out.push({ title, url, ms, description: text(b, "description"), categories: texts(b, "category"), guid: text(b, "guid") });
  }
  return out;
}

const newsId = (source: string, item: FeedItem) => `${source}:${(item.guid ?? item.url).replace(/^https?:\/\//, "").slice(0, 280)}`;

function news(source: NewsRow["source"], country: NewsRow["country"], item: FeedItem, kind: NewsKind, importance: Importance, extra: Partial<NewsRow> = {}): NewsRow {
  return {
    id: newsId(source, item),
    source,
    trust: "official",
    kind,
    country,
    title: clipTitle(item.title),
    summary: clip(item.description),
    url: item.url,
    published_at: isoUtc(item.ms),
    importance,
    dedupe_key: dedupeKey(source, item.title, item.ms),
    event_id: null,
    hidden: false,
    ...extra,
  };
}

// ---- Federal Reserve ----

const MONEY_TOPICS = /\b(monetary|economy|economic|outlook|inflation|labor|employment|rates?|financial stability|projections)\b/i;

/** press_monetary.xml: the FOMC statement (linked to the decision event), the minutes, the rest. */
export function fedMonetary(xml: string): NewsRow[] {
  return feedItems(xml).map((it) => {
    // the Fed repeats the title as the description: show nothing rather than the same line twice
    const base = { summary: null };
    if (/issues FOMC statement/i.test(it.title)) return news("fed", "us", it, "decision", 3, { ...base, event_id: `fed:fomc:${nyDay(it.ms)}:decision` });
    if (/^Minutes of the Federal Open Market Committee/i.test(it.title)) return news("fed", "us", it, "minutes", 2, { ...base, event_id: minutesEvent(nyDay(it.ms)) });
    if (/discount rate meetings?/i.test(it.title)) return news("fed", "us", it, "minutes", 1, base);
    return news("fed", "us", it, "press_release", 2, base);
  });
}

/** speeches.xml / testimony.xml: «Speaker, Title». The Chair and the policy report weigh most. */
export function fedSpeeches(xml: string, kind: "speech" | "testimony"): NewsRow[] {
  return feedItems(xml).map((it) => {
    const speaker = it.title.split(",")[0]?.trim() ?? "";
    const chair = speaker === FED_CHAIR || /Monetary Policy Report/i.test(it.title);
    const importance: Importance = chair ? 3 : MONEY_TOPICS.test(it.title) ? 2 : 1;
    return news("fed", "us", it, kind, importance);
  });
}

// ---- ECB ----

/** press.html: decisions, the press conference, the President's and other speeches, press releases. */
export function ecbPress(xml: string): NewsRow[] {
  return feedItems(xml).map((it) => {
    const title = it.title.trim();
    const item = { ...it, title };
    if (/^Monetary policy decisions$/i.test(title)) return news("ecb", "eu", item, "decision", 3);
    if (/Monetary policy statement/i.test(title)) return news("ecb", "eu", item, "press_conference", 3);
    const speaker = title.includes(":") ? title.split(":")[0] : "";
    if (speaker && speaker.split(/\s+/).length <= 4) {
      const president = speaker.includes(ECB_PRESIDENT);
      return news("ecb", "eu", item, "speech", president ? 3 : MONEY_TOPICS.test(title) ? 2 : 1);
    }
    return news("ecb", "eu", item, "press_release", 1);
  });
}

// ---- White House ----

/** Only what can move markets; everything else is kept hidden (never shown). */
const MARKET_TOPICS =
  /\b(tariffs?|trade|imports?|exports?|sanction\w*|duties|customs|housing|federal reserve|interest rates?|inflation|taxe?s?|budget|debt|deficit|treasury|economy|economic|energy|oil|gas|dollar|currency|crypto|digital assets?|semiconductors?|steel|aluminum|manufacturing|banks?|banking|jobs|labor market|investment)\b/i;
const HEAVY_TOPICS = /\b(tariffs?|imports?|sanction\w*|duties|trade agreement|federal reserve|interest rates?)\b/i;

/** Ceremonial proclamations («National Seafood Month, 2026», «Columbus Day, 2026») are never market news. */
const CEREMONIAL = /\b(Month|Day|Week|Days)(,\s*\d{4})?\s*$|^National\b/i;

/**
 * About markets: the topic is in the title, or the text names a heavy one (tariffs, sanctions, imports, the Fed).
 * General words in a long text («economy», «investment») are not enough — they are everywhere.
 */
export function aboutMarkets(title: string, description: string | null): boolean {
  if (CEREMONIAL.test(title.trim())) return false;
  return MARKET_TOPICS.test(title) || HEAVY_TOPICS.test(description ?? "");
}

/** presidential-actions/feed: executive orders and proclamations on the economy. */
export function whiteHouseActions(xml: string): NewsRow[] {
  return feedItems(xml).map((it) => {
    const title = titleCase(it.title);
    const about = `${it.title} ${it.description ?? ""}`;
    const market = aboutMarkets(it.title, it.description);
    return news("whitehouse", "us", { ...it, title }, "presidential_action", HEAVY_TOPICS.test(about) ? 3 : 2, {
      summary: clip(whiteHouseTeaser(it.description)),
      hidden: !market,
    });
  });
}

/** news/feed: only «Briefings & Statements» on the economy (releases and fact sheets are promotion). */
export function whiteHouseNews(xml: string): NewsRow[] {
  return feedItems(xml).map((it) => {
    const about = `${it.title} ${it.description ?? ""}`;
    const statement = it.categories.some((c) => /Briefings & Statements/i.test(c));
    return news("whitehouse", "us", it, "statement", HEAVY_TOPICS.test(about) ? 3 : 2, {
      summary: clip(whiteHouseTeaser(it.description)),
      hidden: !(statement && aboutMarkets(it.title, it.description)),
    });
  });
}

/** WordPress appends «The post … appeared first on The White House.» — not part of the teaser. */
export function whiteHouseTeaser(s: string | null): string | null {
  if (!s) return null;
  // markup removal leaves a space before the final full stop: «…The White House .»
  return s.replace(/\s*The post .* appeared first on The White House\s*\.?\s*$/i, "").replace(/\s*\[…\]\s*$/, " …").trim() || null;
}

/** ALL-CAPS proclamation titles read badly: «Adjusting imports of robotics…». */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ---- BEA ----

const BEA_CODES: { re: RegExp; code: string; importance: Importance; title: string }[] = [
  // the national release only: «GDP (Advance Estimate)…», «Gross Domestic Product, …» — not «GDP by County»
  { re: /^(GDP|Gross Domestic Product)(\s*\(|,)/i, code: "us_gdp", importance: 3, title: "Gross Domestic Product" },
  { re: /^Personal Income and Outlays/i, code: "us_pce", importance: 3, title: "Personal Income and Outlays (PCE)" },
  { re: /International Trade in Goods and Services/i, code: "us_trade", importance: 2, title: "U.S. International Trade in Goods and Services" },
];
const beaKind = (summary: string) => BEA_CODES.find((c) => c.re.test(summary));

/** BEA's .ics (UTC): the main releases from the last two weeks to four months ahead. */
export function beaSchedule(ics: string, now: number): EventRow[] {
  const from = now - 14 * 86_400_000;
  const to = now + 120 * 86_400_000;
  const rows: EventRow[] = [];
  for (const e of parseIcs(ics)) {
    if (e.start < from || e.start > to) continue;
    const k = beaKind(e.summary);
    const day = nyDay(e.start);
    rows.push({
      id: `bea:${k?.code ?? slug(e.summary).slice(0, 60)}:${day}`,
      source: "bea",
      kind: "release",
      code: k?.code ?? null,
      country: "us",
      title: clipTitle(e.summary),
      importance: k?.importance ?? 1,
      starts_at: isoUtc(e.start),
      time_tbd: false,
      url: "https://www.bea.gov/news/schedule",
    });
  }
  // the file repeats some dates: keep one row per id
  return Array.from(new Map(rows.map((r) => [r.id, r])).values());
}

/** BEA's RSS: each release as news, and its figure for the matching calendar event. */
export function beaReleases(xml: string): { news: NewsRow[]; results: EventResult[] } {
  const out = { news: [] as NewsRow[], results: [] as EventResult[] };
  for (const b of blocks(xml, "item")) {
    const title = text(b, "title");
    const url = cleanUrl(link(b));
    const ms = parseFeedDate(text(b, "pubDate"));
    if (!title || !url || ms === null) continue;
    const k = beaKind(title);
    const day = nyDay(ms);
    const eventId = k ? `bea:${k.code}:${day}` : null;
    const description = text(b, "description");
    const item: FeedItem = { title, url, ms, description, categories: [], guid: text(b, "guid") };
    out.news.push(news("bea", "us", item, "data", k?.importance ?? 1, { event_id: eventId }));
    if (eventId) {
      const current = raw(b, "current");
      const previous = raw(b, "previous");
      out.results.push({ id: eventId, status: "released", actual: beaFigure(current), previous: beaFigure(previous), summary: clip(description) });
    }
  }
  return out;
}

/** `<percentChange>+3.4</percentChange>` → `+3.4%` (BEA writes it with or without the sign / percent). */
export function beaFigure(block: string | null): string | null {
  if (!block) return null;
  const v = text(block, "percentChange");
  if (!v) return null;
  const m = v.match(/[+-]?\d+(?:\.\d+)?%?/);
  if (!m) return null;
  const n = m[0].replace(/%$/, "");
  return `${/^[+-]/.test(n) ? n : `+${n}`}%`.slice(0, 60);
}

/** Plain text for logs. */
export const short = (s: string) => plainText(s).slice(0, 200);
