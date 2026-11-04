import { describe, expect, it } from "vitest";
import { collectFeeds, retryEvery, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import { listedEvents } from "./schedules";
import { BLS_API_V1, blsLatest, blsResults, parseBlsResponse } from "./bls";
import { eiaLatest, eiaResult, parseEia } from "./eia";
import { censusLatest, parseCensus } from "./census";
import { eurostatLatest, parseEurostat } from "./eurostat";
import { FEEDS } from "./sources";

// The BLS API's answer of 4 November 2026 (api.bls.gov v1, read from the developer's machine), trimmed
const bls = (rows: Record<string, [string, string][]>) =>
  JSON.stringify({
    status: "REQUEST_SUCCEEDED",
    message: ["Unable to get Catalog Data for series JTS000000000000000JOL"],
    Results: { series: Object.entries(rows).map(([seriesID, data]) => ({ seriesID, data: data.map(([p, value]) => ({ year: p.slice(0, 4), period: `M${p.slice(5)}`, value })) })) },
  });
const BLS_NOV4 = bls({
  CES0000000001: [["2026-09", "159044"], ["2026-08", "159015"], ["2026-07", "158980"]],
  LNS14000000: [["2026-09", "4.2"], ["2026-08", "4.1"]],
  CUSR0000SA0: [["2026-09", "336.298"], ["2026-08", "334.131"], ["2026-07", "333.0"]],
  WPSFD4: [["2026-09", "159.780"], ["2026-08", "157.662"]],
  JTS000000000000000JOL: [["2026-09", "7523"], ["2026-08", "7190"]],
});

function network(pages: Record<string, string>) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    const key = Object.keys(pages).find((p) => url.startsWith(p));
    const body = key === undefined ? undefined : pages[key];
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, text: async () => body ?? "" };
  };
  return { fetcher, asked };
}

const NOV4 = Date.UTC(2026, 10, 4, 14, 0); // Wednesday, the day after JOLTS

describe("catching up: a release without a figure is asked again for a week", () => {
  it("JOLTS of 3 November (the collector started after it): filled in the next day, by its own month", async () => {
    const { db, events } = memoryFeedsDb({ events: listedEvents() });
    const { fetcher } = network({ [BLS_API_V1]: BLS_NOV4 });
    await collectFeeds({ scope: "releases", now: NOV4, fetch: fetcher, db });
    expect(events.get("bls:us_jolts:2026-11-03")).toMatchObject({ status: "released", actual: "7.52M", previous: "7.19M" });
  });

  it("the month is found even when a newer one is in the API (asked days later)", () => {
    const data = parseBlsResponse(JSON.parse(bls({ CUSR0000SA0: [["2026-10", "337.0"], ["2026-09", "336.298"], ["2026-08", "334.131"]] })));
    expect(blsResults(["bls:us_cpi:2026-10-14"], data)).toEqual([]); // no such listed day
    // CPI of 10 November covers October; the API already has October and September
    expect(blsResults(["bls:us_cpi:2026-11-10"], data)[0]).toMatchObject({ actual: "+0.2%", previous: "+0.6%" });
  });

  it("EIA: the week is found by its date, not as the newest", () => {
    const values = parseEia({ response: { data: [{ period: "2026-11-06", value: "409000" }, { period: "2026-10-30", value: "408000" }, { period: "2026-10-23", value: "410625" }, { period: "2026-10-16", value: "412517" }] } });
    expect(eiaResult("eia:us_eia_crude:2026-11-04", values)).toMatchObject({ actual: "−2.6M", previous: "−1.9M" });
  });

  it("the pace: 10 minutes after the release, 30 the first day (an hour without a BLS key), then daily", () => {
    const MIN = 60_000;
    expect(retryEvery(30 * MIN, 2 * 60 * MIN)).toBe(10 * MIN);
    expect(retryEvery(5 * 60 * MIN, 2 * 60 * MIN)).toBe(30 * MIN);
    expect(retryEvery(5 * 60 * MIN, 2 * 60 * MIN, 60 * MIN)).toBe(60 * MIN);
    expect(retryEvery(2 * 24 * 60 * MIN, 2 * 60 * MIN)).toBe(24 * 60 * MIN);
  });

  it("decisions and press conferences are not «waiting for a figure»", async () => {
    const { db } = memoryFeedsDb({ events: listedEvents() });
    expect((await db.waitingEvents("fed", Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 31))).length).toBe(0);
  });
});

describe("«previous» before the release", () => {
  it("a figure, once in, becomes the «previous» of the same indicator's next release", async () => {
    const { db, events } = memoryFeedsDb({ events: listedEvents() });
    await collectFeeds({ scope: "releases", now: NOV4, fetch: network({ [BLS_API_V1]: BLS_NOV4 }).fetcher, db });
    // JOLTS of 3 November → the next JOLTS, 1 December
    expect(events.get("bls:us_jolts:2026-12-01")).toMatchObject({ status: "scheduled", previous: "7.52M" });
    expect(events.get("bls:us_jolts:2026-12-01")?.actual).toBeUndefined();
  });

  it("the daily schedules run fills «previous» of every indicator's next release from what the sources publish now", async () => {
    const { db, events, runs } = memoryFeedsDb();
    await collectFeeds({ scope: "schedules", now: NOV4, fetch: network({ [BLS_API_V1]: BLS_NOV4 }).fetcher, db });
    expect(events.get("bls:us_nfp:2026-11-06")).toMatchObject({ previous: "+29K · 4.2%" });
    expect(events.get("bls:us_cpi:2026-11-10")).toMatchObject({ previous: "+0.6%" });
    expect(events.get("bls:us_jolts:2026-12-01")).toMatchObject({ previous: "7.52M" });
    // only the nearest release of an indicator: the December NFP still waits for November's
    expect(events.get("bls:us_nfp:2026-12-04")?.previous).toBeUndefined();
    // the sources that did not answer here are named in the log, the rest is saved
    expect(runs.find((r) => r.source === "previous-values")).toMatchObject({ ok: false });
    expect(runs.find((r) => r.source === "previous-values")?.error).toMatch(/^4 set; /);
  });

  it("a published release keeps the source's own «previous» (never overwritten)", async () => {
    const { db, events } = memoryFeedsDb({ events: listedEvents() });
    events.set("bls:us_nfp:2026-11-06", { ...events.get("bls:us_nfp:2026-11-06")!, status: "released", actual: "+31K", previous: "+30K" });
    await db.setPrevious([{ id: "bls:us_nfp:2026-11-06", previous: "+1K" }]);
    expect(events.get("bls:us_nfp:2026-11-06")?.previous).toBe("+30K");
  });

  it("BEA: the stored release's figure passes to the next one of the same indicator", async () => {
    const { db, events } = memoryFeedsDb({
      events: [
        { id: "bea:us_pce:2026-11-25", source: "bea", kind: "release", code: "us_pce", country: "us", title: "Personal Income and Outlays", importance: 3, starts_at: "2026-11-25T13:30:00.000Z", time_tbd: false, url: null },
      ],
    });
    const rss = `<rss><channel><item><title>Personal Income and Outlays, September 2026</title><link>https://www.bea.gov/news/2026/pio-september-2026</link><description>Personal income increased 0.4 percent in September.</description><data><main><current><infoDate>September 2026</infoDate><percentChange>+0.2</percentChange></current><previous><infoDate>August 2026</infoDate><percentChange>0.3%</percentChange></previous></main></data><pubDate>Thu, 29 Oct 2026 08:30:00 EDT</pubDate></item></channel></rss>`;
    // the stored release of 29 October (BEA's feed gives its figure)
    await db.upsertEvents([{ id: "bea:us_pce:2026-10-29", source: "bea", kind: "release", code: "us_pce", country: "us", title: "Personal Income and Outlays", importance: 3, starts_at: "2026-10-29T12:30:00.000Z", time_tbd: false, url: null }]);
    await collectFeeds({ scope: "releases", now: NOV4, fetch: network({ [FEEDS.beaRss]: rss }).fetcher, db });
    expect(events.get("bea:us_pce:2026-10-29")).toMatchObject({ status: "released", actual: "+0.2%" });
    expect(events.get("bea:us_pce:2026-11-25")).toMatchObject({ status: "scheduled", previous: "+0.2%" });
  });

  it("each source's latest figure: BLS, EIA, Census (the month before the release), Eurostat (GDP twice a quarter)", () => {
    expect(blsLatest(parseBlsResponse(JSON.parse(BLS_NOV4)))).toEqual(new Map([["us_nfp", "+29K · 4.2%"], ["us_cpi", "+0.6%"], ["us_ppi", "+1.3%"], ["us_jolts", "7.52M"]]));
    expect(eiaLatest("us_eia_gas", parseEia({ response: { data: [{ period: "2026-10-23", value: "3724" }, { period: "2026-10-16", value: "3644" }] } }))).toBe("+80 Bcf");
    const head = ["cell_value", "data_type_code", "category_code", "seasonally_adj", "time"];
    expect(censusLatest("us_retail_sales", "2026-10", parseCensus([head, ["0.6", "MPCSM", "44X72", "yes", "2026-09"]], "44X72"))).toBe("+0.6%");
    const gdp = parseEurostat({ updated: "2026-10-30T23:00:00+0100", id: ["geo", "time"], size: [1, 2], value: { "0": 0.6, "1": 0.4 }, dimension: { geo: { category: { index: { EA: 0 } } }, time: { category: { index: { "2026-Q2": 0, "2026-Q3": 1 } } } } });
    // the flash of 13 November is the same quarter as the preliminary one of 30 October: it compares with Q2
    expect(eurostatLatest("eu_gdp_flash", gdp, "2026-11-13T10:00:00.000Z", NOV4)).toBe("+0.6%");
    expect(eurostatLatest("eu_gdp_prelim", gdp, "2027-01-29T10:00:00.000Z", NOV4)).toBe("+0.4%");
  });
});
