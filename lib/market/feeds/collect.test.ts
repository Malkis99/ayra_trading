import { describe, expect, it } from "vitest";
import { BLS_EVERY_MS, collectFeeds, dedupe, recent, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import { FEEDS } from "./sources";
import { BLS_API_V1, BLS_API_V2 } from "./bls";
import type { NewsRow } from "./types";
import { sameSecret } from "./secret";

const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;
const item = (title: string, link: string, date: string) => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;

const memoryDb = (seed: { lastBls?: number } = {}) => memoryFeedsDb({ lastRuns: seed.lastBls === undefined ? {} : { "bls-api": seed.lastBls } });

/** A network that knows some URLs; the rest answer 404. Records what was asked. */
function network(pages: Record<string, string>, opts: { failing?: string[] } = {}) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    if (opts.failing?.includes(url)) throw new Error("network down");
    const body = pages[url];
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, text: async () => body ?? "" };
  };
  return { fetcher, asked };
}

const NOW = Date.UTC(2026, 10, 6, 13, 45); // 15 minutes after the November NFP release (08:30 ET)

describe("the collector", () => {
  it("schedules: the listed FOMC / ECB / BLS events and BEA's .ics; every run is logged", async () => {
    const { db, events, runs } = memoryDb();
    const { fetcher } = network({ [FEEDS.beaIcs]: "BEGIN:VEVENT\nSUMMARY:Personal Income and Outlays\\, October 2026\nDTSTART:20261125T133000Z\nEND:VEVENT" });
    const out = await collectFeeds({ scope: "schedules", now: NOW, fetch: fetcher, db });
    expect(out.results.find(r => r.source === "ons-gdp-schedule")).toMatchObject({ ok: false });
    expect(out.results.filter(r => r.source !== "ons-gdp-schedule").map((r) => [r.source, r.ok])).toEqual([
      ["schedules-listed", true],
      ["bls-ppi-schedule", false], // the official schedule is not in this test's network
      ["bls-jolts-schedule", false],
      ["bls-jolts-history", true],
      ["bea-schedule", true],
      ["eurostat-schedule", false], // not in this test's network
      ["previous-values", false], // the sources are not in this test's network either
    ]);
    expect(events.has("fed:fomc:2026-12-09:decision")).toBe(true);
    expect(events.has("bea:us_pce:2026-11-25")).toBe(true);
    expect(runs.some(r => r.source === "ons-gdp-schedule")).toBe(true);
    expect(runs.filter(r => r.source !== "ons-gdp-schedule").map(r => r.source)).toEqual(["schedules-listed", "bls-ppi-schedule", "bls-jolts-schedule", "bls-jolts-history", "bea-schedule", "eurostat-schedule", "previous-values"]);
  });

  it("news: a failing source never stops the others; its error is logged", async () => {
    const { db, news, runs } = memoryDb();
    const { fetcher } = network(
      {
        [FEEDS.fedMonetary]: rss(item("Federal Reserve issues FOMC statement", "https://www.federalreserve.gov/a.htm", "Wed, 28 Oct 2026 18:00:00 GMT")),
        [FEEDS.ecbPress]: rss(item(" Monetary policy decisions", "https://www.ecb.europa.eu/b.html", "Thu, 29 Oct 2026 14:15:00 +0100")),
      },
      { failing: [FEEDS.fedSpeeches] }
    );
    const out = await collectFeeds({ scope: "news", now: NOW, fetch: fetcher, db });
    const bySource = Object.fromEntries(out.results.map((r) => [r.source, r]));
    expect(bySource["fed-monetary"]).toMatchObject({ ok: true, items: 1 });
    expect(bySource["ecb-press"]).toMatchObject({ ok: true, items: 1 });
    expect(bySource["fed-speeches"]).toMatchObject({ ok: false, error: "network down" });
    expect(bySource["fed-testimony"]).toMatchObject({ ok: false, error: `HTTP 404 ${FEEDS.fedTestimony}` });
    expect(news.size).toBe(2);
    // the October decision is not a stored event: the link is dropped, the news is kept
    expect([...news.values()].find((n) => n.source === "fed")?.event_id).toBeNull();
    expect(runs.find((r) => r.source === "fed-speeches")).toMatchObject({ ok: false, items: 0 });
  });

  it("drops items older than 90 days or dated in the future (a feed printed 30 Dec 1899), and repeats", () => {
    const row = (id: string, at: string, key = id) => ({ id, published_at: at, dedupe_key: key }) as NewsRow;
    expect(recent([row("a", "2026-11-01T00:00:00Z"), row("b", "1899-12-30T15:00:00Z"), row("c", "2026-07-01T00:00:00Z"), row("d", "2027-01-01T00:00:00Z")], NOW).map((r) => r.id)).toEqual(["a"]);
    expect(dedupe([row("a", "x", "k"), row("b", "x", "k"), row("c", "x", "m")]).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("BLS: asks the API only for a release of the last two hours not filled in, then fills in the figure", async () => {
    const { db, events } = memoryDb();
    const { fetcher: schedules } = network({});
    await collectFeeds({ scope: "schedules", now: NOW, fetch: schedules, db });
    const answer = JSON.stringify({
      status: "REQUEST_SUCCEEDED",
      Results: {
        series: [
          { seriesID: "CES0000000001", data: [["2026", "M10", "159073"], ["2026", "M09", "159044"], ["2026", "M08", "159015"]].map(([year, period, value]) => ({ year, period, value })) },
          { seriesID: "LNS14000000", data: [{ year: "2026", period: "M10", value: "4.3" }] },
        ],
      },
    });
    const { fetcher, asked } = network({ [BLS_API_V1]: answer });
    await collectFeeds({ scope: "news", now: NOW, fetch: fetcher, db });
    expect(asked.filter((u) => u.startsWith("https://api.bls.gov"))).toEqual([BLS_API_V1]);
    expect(events.get("bls:us_nfp:2026-11-06")).toMatchObject({ status: "released", actual: "+29K · 4.3%", previous: "+29K" });

    // filled in: the next run does not ask again
    const second = network({ [BLS_API_V1]: answer });
    await collectFeeds({ scope: "news", now: NOW + 20 * 60_000, fetch: second.fetcher, db });
    expect(second.asked.some((u) => u.startsWith("https://api.bls.gov"))).toBe(false);
  });

  it("BLS: not more often than every ten minutes, never outside a release window, the key switches to v2", async () => {
    const recentCall = memoryDb({ lastBls: NOW - BLS_EVERY_MS / 2 });
    await collectFeeds({ scope: "schedules", now: NOW, fetch: network({}).fetcher, db: recentCall.db });
    const throttled = network({});
    await collectFeeds({ scope: "news", now: NOW, fetch: throttled.fetcher, db: recentCall.db });
    expect(throttled.asked.some((u) => u.startsWith("https://api.bls.gov"))).toBe(false);

    const quietDay = memoryDb();
    const quiet = network({});
    await collectFeeds({ scope: "news", now: Date.UTC(2026, 10, 7, 15), fetch: quiet.fetcher, db: quietDay.db });
    expect(quiet.asked.some((u) => u.startsWith("https://api.bls.gov"))).toBe(false);

    const keyed = memoryDb();
    await collectFeeds({ scope: "schedules", now: NOW, fetch: network({}).fetcher, db: keyed.db });
    const v2 = network({ [BLS_API_V2]: JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series: [] } }) });
    await collectFeeds({ scope: "news", now: NOW, fetch: v2.fetcher, db: keyed.db, blsKey: "k" });
    expect(v2.asked).toContain(BLS_API_V2);
  });

  it("releases: the frequent run asks only BEA (and BLS around a release), not the other feeds", async () => {
    const { db } = memoryDb();
    const { fetcher, asked } = network({});
    const out = await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 7, 15), fetch: fetcher, db });
    expect(asked).toEqual([FEEDS.beaRss]);
    expect(out.results.map((r) => r.source)).toEqual(["bea-releases"]);
  });

  it("cleans up old rows only when asked", async () => {
    const { db } = memoryDb();
    expect((await collectFeeds({ scope: "schedules", now: NOW, fetch: network({}).fetcher, db })).pruned).toBeNull();
    expect((await collectFeeds({ scope: "schedules", now: NOW, fetch: network({}).fetcher, db, prune: true })).pruned).toBe(7);
  });
});

describe("the collector's door", () => {
  it("opens only for the exact secret", () => {
    expect(sameSecret("abc123", "abc123")).toBe(true);
    expect(sameSecret("abc124", "abc123")).toBe(false);
    expect(sameSecret("abc12", "abc123")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
  });
});
