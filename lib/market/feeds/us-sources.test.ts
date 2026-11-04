import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { CENSUS_RELEASES, claimsWeekEnding, dolClaimsDates, eiaCrudeDates, eiaGasDates, listedUsEvents, weekEnding } from "./schedules-us";
import { listedEvents } from "./schedules";
import { EIA_SERIES, eiaResult, eiaUrl, parseEia } from "./eia";
import { claimsResult, parseClaims } from "./dol";
import { pdfText } from "./pdf-text";
import { censusResult, censusUrl, parseCensus } from "./census";
import { collectFeeds, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import type { EventRow } from "./types";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { en } from "@/lib/i18n/dictionaries/en";

const byId = (id: string) => listedUsEvents().find((e) => e.id === id);

describe("EIA, Census and DOL schedules (official pages, Eastern Time → UTC)", () => {
  it("EIA crude: Wednesday 10:30 ET; the Veterans Day week on Thursday at noon; 2027 holiday weeks left out until EIA lists them", () => {
    expect(byId("eia:us_eia_crude:2026-11-04")?.starts_at).toBe("2026-11-04T15:30:00.000Z");
    expect(byId("eia:us_eia_crude:2026-11-11")).toBeUndefined();
    expect(byId("eia:us_eia_crude:2026-11-12")?.starts_at).toBe("2026-11-12T17:00:00.000Z");
    expect(byId("eia:us_eia_crude:2027-07-14")?.starts_at).toBe("2027-07-14T14:30:00.000Z"); // summer time
    expect(byId("eia:us_eia_crude:2027-01-20")).toBeUndefined();
    expect(eiaCrudeDates().every(([d]) => d >= "2026-11-04" && d <= "2027-12-31")).toBe(true);
  });

  it("EIA gas: Thursday 10:30 ET; Veterans Day → Friday, Thanksgiving → Wednesday noon (EIA 2026, OMB 2027)", () => {
    expect(byId("eia:us_eia_gas:2026-11-05")?.starts_at).toBe("2026-11-05T15:30:00.000Z");
    expect(byId("eia:us_eia_gas:2026-11-13")?.starts_at).toBe("2026-11-13T15:30:00.000Z");
    expect(byId("eia:us_eia_gas:2026-11-25")?.starts_at).toBe("2026-11-25T17:00:00.000Z");
    expect(byId("eia:us_eia_gas:2027-11-10")?.starts_at).toBe("2027-11-10T17:00:00.000Z");
    expect(eiaGasDates()).toHaveLength(61);
  });

  it("DOL claims: Thursday 8:30 ET, Wednesday when Thursday is a federal holiday", () => {
    expect(byId("dol:us_jobless_claims:2026-11-05")?.starts_at).toBe("2026-11-05T13:30:00.000Z");
    expect(byId("dol:us_jobless_claims:2026-11-25")?.starts_at).toBe("2026-11-25T13:30:00.000Z");
    expect(byId("dol:us_jobless_claims:2026-11-26")).toBeUndefined();
    expect(dolClaimsDates()).toContain("2027-11-10");
    expect(byId("dol:us_jobless_claims:2026-11-05")?.importance).toBe(3);
  });

  it("Census: the releases of the Economic Indicator Calendar at 8:30 or 10:00 ET", () => {
    expect(byId("census:us_retail_sales:2026-11-17")?.starts_at).toBe("2026-11-17T13:30:00.000Z");
    expect(byId("census:us_new_home_sales:2026-11-25")?.starts_at).toBe("2026-11-25T15:00:00.000Z");
    expect(byId("census:us_housing_starts:2027-07-20")?.starts_at).toBe("2027-07-20T12:30:00.000Z");
    expect(byId("census:us_retail_sales:2026-11-17")?.importance).toBe(3);
    expect(byId("census:us_durable_goods:2026-11-25")?.importance).toBe(2);
  });

  it("the lists reach December 2027; every date is a weekday; ids are unique; the collector's list has them", () => {
    const rows = listedUsEvents();
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect([1, 2, 3, 4, 5]).toContain(new Date(r.starts_at).getUTCDay());
    for (const r of Object.values(CENSUS_RELEASES)) expect(Object.keys(r.dates).sort().at(-1)! >= "2027-12-01").toBe(true);
    expect(listedEvents().filter((e) => e.source === "eia" || e.source === "census" || e.source === "dol")).toHaveLength(rows.length);
  });

  it("the dictionary names every new event and source in Russian and English", () => {
    for (const code of new Set(listedUsEvents().map((r) => r.code!))) {
      expect((ru.market.calendar.own.events as Record<string, string>)[code]).toBeTruthy();
      expect((en.market.calendar.own.events as Record<string, string>)[code]).toBeTruthy();
    }
    for (const s of ["eia", "census", "dol"] as const) {
      expect(ru.market.calendar.own.sources[s]).toBeTruthy();
      expect(en.market.calendar.own.sources[s]).toBeTruthy();
    }
  });

  it("the weeks the reports cover", () => {
    expect(weekEnding("2026-11-04")).toBe("2026-10-30"); // crude, Wednesday
    expect(weekEnding("2026-11-13")).toBe("2026-11-06"); // gas moved to Friday
    expect(claimsWeekEnding("2026-10-29")).toBe("2026-10-24");
  });
});

// The API's answer of 2026-11-04 (DEMO_KEY), trimmed
const EIA_CRUDE = { response: { data: [{ period: "2026-10-23", series: "WCESTUS1", value: "410625" }, { period: "2026-10-16", value: "412517" }, { period: "2026-10-09", value: "415577" }] } };
const EIA_GAS = { response: { data: [{ period: "2026-10-23", value: "3724" }, { period: "2026-10-16", value: "3644" }, { period: "2026-10-09", value: "3567" }] } };

describe("EIA figures", () => {
  it("the week's change and the one before: crude in million barrels, gas in Bcf", () => {
    expect(eiaResult("eia:us_eia_crude:2026-10-28", parseEia(EIA_CRUDE))).toEqual({ id: "eia:us_eia_crude:2026-10-28", status: "released", actual: "−1.9M", previous: "−3.1M", summary: null });
    expect(eiaResult("eia:us_eia_gas:2026-10-29", parseEia(EIA_GAS))).toMatchObject({ actual: "+80 Bcf", previous: "+77 Bcf" });
  });
  it("nothing until the API has the week the release covers", () => {
    expect(eiaResult("eia:us_eia_crude:2026-11-04", parseEia(EIA_CRUDE))).toBeNull();
    expect(parseEia({ error: "x" })).toEqual([]);
  });
  it("asks for the newest six weeks of one series (a report caught up days later still finds its week)", () => {
    const u = new URL(eiaUrl("us_eia_crude", "KEY"));
    expect(u.origin + u.pathname).toBe("https://api.eia.gov/v2/petroleum/stoc/wstk/data/");
    expect(u.searchParams.get("facets[series][]")).toBe(EIA_SERIES.us_eia_crude.series);
    expect(u.searchParams.get("length")).toBe("6");
  });
});

/** A one-page PDF with a Flate-compressed content stream, as DOL's release is built. */
function pdfOf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  // split words with kerning numbers, as a real release does
  const content = lines.map((l, i) => `BT /F1 10 Tf 1 0 0 1 50 ${700 - i * 14} Tm [(${esc(l.slice(0, 7))})-2(${esc(l.slice(7))})] TJ ET`).join("\n");
  const stream = deflateSync(Buffer.from(content, "latin1"));
  const head = Buffer.from("%PDF-1.7\n1 0 obj <</Type/Catalog>> endobj\n2 0 obj <</Length " + stream.length + "/Filter/FlateDecode>>\nstream\n", "latin1");
  return new Uint8Array(Buffer.concat([head, stream, Buffer.from("\nendstream\nendobj\n%%EOF", "latin1")]));
}

const RELEASE = [
  "TRANSMISSION OF MATERIALS IN THIS RELEASE IS EMBARGOED UNTIL 8:30 A.M. (Eastern) Thursday, October 29, 2026",
  "UNEMPLOYMENT INSURANCE WEEKLY CLAIMS",
  "In the week ending October 24, the advance figure for seasonally adjusted initial claims was 194,000, a decrease of",
  "1,000 from the previous week's revised level. The previous week's level was revised up by 1,000 from 194,000 to 195,000.",
];

describe("DOL weekly claims from the release (PDF)", () => {
  it("reads the text of the release's compressed streams", () => {
    expect(pdfText(pdfOf(["Hello (world)", "second line"]))).toBe("Hello (world) second line");
  });
  it("the release day, this week's figure and the revised one before", () => {
    expect(parseClaims(pdfText(pdfOf(RELEASE)))).toEqual({ day: "2026-10-29", actual: "194K", previous: "195K" });
    expect(parseClaims(RELEASE.join(" ").replace("revised up by 1,000 from 194,000 to 195,000", "unrevised at 201,000"))).toMatchObject({ previous: "201K" });
  });
  it("an old release is never taken for a new one; other wording gives nothing", () => {
    const release = parseClaims(RELEASE.join(" "));
    expect(claimsResult(["dol:us_jobless_claims:2026-11-05"], release)).toEqual([]);
    expect(claimsResult(["dol:us_jobless_claims:2026-10-29"], release)).toEqual([{ id: "dol:us_jobless_claims:2026-10-29", status: "released", actual: "194K", previous: "195K", summary: null }]);
    expect(parseClaims("News Release. Something else entirely.")).toBeNull();
  });
});

const head = ["cell_value", "data_type_code", "category_code", "seasonally_adj", "time", "us"];
describe("Census figures (Economic Indicators API, documented format)", () => {
  it("retail sales: Census's own percent change, this month and the one before; not-adjusted rows ignored", () => {
    const json = [head, ["0.4", "MPCSM", "44X72", "yes", "2026-10", "1"], ["-0.2", "MPCSM", "44X72", "yes", "2026-09", "1"], ["9.9", "MPCSM", "44X72", "no", "2026-10", "1"], ["1.0", "MPCSM", "44000", "yes", "2026-10", "1"]];
    expect(censusResult("census:us_retail_sales:2026-11-17", parseCensus(json, "44X72"))).toMatchObject({ actual: "+0.4%", previous: "−0.2%" });
  });
  it("durable goods without a percent series: computed from new orders", () => {
    const json = [head, ["300000", "NO", "MDM", "yes", "2026-10", "1"], ["295000", "NO", "MDM", "yes", "2026-09", "1"], ["300000", "NO", "MDM", "yes", "2026-08", "1"]];
    expect(censusResult("census:us_durable_goods:2026-11-25", parseCensus(json, "MDM"))).toMatchObject({ actual: "+1.7%", previous: "−1.7%" });
  });
  it("housing starts in millions, new home sales in thousands (annual rate)", () => {
    const starts = [head, ["1312", "TOTAL", "STARTS", "yes", "2026-10", "1"], ["1,290", "TOTAL", "STARTS", "yes", "2026-09", "1"]];
    expect(censusResult("census:us_housing_starts:2026-11-18", parseCensus(starts, "STARTS"))).toMatchObject({ actual: "1.31M", previous: "1.29M" });
    const sold = [head, ["693", "TOTAL", "SOLD", "yes", "2026-10", "1"]];
    expect(censusResult("census:us_new_home_sales:2026-11-25", parseCensus(sold, "SOLD"))).toMatchObject({ actual: "693K", previous: null });
  });
  it("nothing until the reference month is in; any other answer gives nothing", () => {
    expect(censusResult("census:us_retail_sales:2026-11-17", parseCensus([head, ["0.1", "MPCSM", "44X72", "yes", "2026-09", "1"]], "44X72"))).toBeNull();
    expect(parseCensus({ error: "blocked" }, "44X72").size).toBe(0);
  });
  it("asks one program from three months before the reference month", () => {
    const u = new URL(censusUrl("us_retail_sales", "2026-10"));
    expect(u.pathname).toBe("/data/timeseries/eits/marts");
    expect(u.searchParams.get("time")).toBe("from 2026-07");
  });
});

const memoryDb = (rows: EventRow[], last: Record<string, number> = {}) => memoryFeedsDb({ events: rows, lastRuns: last });

/** Answers by URL prefix; everything else 404. */
function network(pages: Record<string, string | Uint8Array>) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    const key = Object.keys(pages).find((p) => url.startsWith(p));
    const body = key === undefined ? undefined : pages[key];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      text: async () => (typeof body === "string" ? body : ""),
      arrayBuffer: async () => (body instanceof Uint8Array ? body.slice().buffer : new ArrayBuffer(0)),
    };
  };
  return { fetcher, asked };
}

describe("the collector asks EIA, Census and DOL only around their releases", () => {
  const allEvents = listedEvents();
  // Wednesday 2026-11-04, 15:45 UTC: 15 minutes after EIA's crude report
  const AFTER_EIA = Date.UTC(2026, 10, 4, 15, 45);

  it("EIA without a key: nothing is asked, the log says the key is missing", async () => {
    const { db, runs } = memoryDb(allEvents);
    const { fetcher, asked } = network({});
    const out = await collectFeeds({ scope: "releases", now: AFTER_EIA, fetch: fetcher, db });
    expect(asked.some((u) => u.includes("api.eia.gov"))).toBe(false);
    expect(out.results.find((r) => r.source === "eia-api")).toMatchObject({ ok: false, error: "EIA_API_KEY is not set: EIA figures are not asked for" });
    expect(runs.some((r) => r.source === "eia-api")).toBe(true);
  });

  it("EIA with a key: the figure is saved once the API has the week; the key never reaches the log", async () => {
    const { db, events, runs } = memoryDb(allEvents);
    const crude = { response: { data: [{ period: "2026-10-30", value: "408000" }, ...EIA_CRUDE.response.data] } };
    const { fetcher, asked } = network({ "https://api.eia.gov/v2/petroleum/stoc/wstk/": JSON.stringify(crude) });
    await collectFeeds({ scope: "releases", now: AFTER_EIA, fetch: fetcher, db, eiaKey: "SECRET-KEY" });
    expect(asked.filter((u) => u.includes("api.eia.gov"))).toHaveLength(1);
    expect(events.get("eia:us_eia_crude:2026-11-04")).toMatchObject({ status: "released", actual: "−2.6M", previous: "−1.9M" });
    expect(JSON.stringify(runs)).not.toContain("SECRET-KEY");
  });

  it("the pace of asking again: 10 minutes right after, 30 minutes the first day, daily for a week, then never", async () => {
    const asksAt = async (ageMs: number, lastAgoMs: number) => {
      const { db } = memoryDb(allEvents, { "eia-api": Date.UTC(2026, 10, 4, 15, 30) + ageMs - lastAgoMs });
      const n = network({});
      await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 4, 15, 30) + ageMs, fetch: n.fetcher, db, eiaKey: "K" });
      return n.asked.some((u) => u.includes("api.eia.gov"));
    };
    const MIN = 60_000;
    expect(await asksAt(15 * MIN, 5 * MIN)).toBe(false); // asked 5 minutes ago
    expect(await asksAt(15 * MIN, 11 * MIN)).toBe(true);
    expect(await asksAt(5 * 60 * MIN, 20 * MIN)).toBe(false); // the rest of the first day: every 30 minutes
    expect(await asksAt(5 * 60 * MIN, 31 * MIN)).toBe(true);
    // the second day: once a day (the next week's report is not out yet on Monday 9 November)
    expect(await asksAt(4 * 24 * 60 * MIN, 5 * 60 * MIN)).toBe(false);
    expect(await asksAt(4 * 24 * 60 * MIN, 25 * 60 * MIN)).toBe(true);
  });

  it("once filled in, never asked again; after a week, given up", async () => {
    const { db, events } = memoryDb(allEvents);
    events.set("eia:us_eia_crude:2026-11-04", { ...events.get("eia:us_eia_crude:2026-11-04")!, status: "released", actual: "−2.6M" });
    const a = network({});
    await collectFeeds({ scope: "releases", now: AFTER_EIA, fetch: a.fetcher, db, eiaKey: "K" });
    expect(a.asked.some((u) => u.includes("api.eia.gov"))).toBe(false);
    // only the weeks of 2027-01: everything older than a week is not asked any more
    const old = memoryDb(allEvents.filter((e) => e.id === "eia:us_eia_crude:2026-11-04"));
    const b = network({});
    await collectFeeds({ scope: "releases", now: AFTER_EIA + 8 * 24 * 60 * 60_000, fetch: b.fetcher, db: old.db, eiaKey: "K" });
    expect(b.asked.some((u) => u.includes("api.eia.gov"))).toBe(false);
  });

  it("DOL: Thursday after 8:30 the release is read and its figure saved", async () => {
    const { db, events } = memoryDb(allEvents);
    const pdf = pdfOf(RELEASE.map((l) => l.replace("October 29", "November 5").replace("October 24", "October 31")));
    const { fetcher } = network({ "https://www.dol.gov/ui/data.pdf": pdf });
    const out = await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 5, 13, 40), fetch: fetcher, db });
    expect(out.results.find((r) => r.source === "dol-claims")).toMatchObject({ ok: true, items: 1 });
    expect(events.get("dol:us_jobless_claims:2026-11-05")).toMatchObject({ status: "released", actual: "194K", previous: "195K" });
  });

  it("DOL still showing last week's release: nothing saved, asked again later", async () => {
    const { db, events } = memoryDb(allEvents);
    const { fetcher } = network({ "https://www.dol.gov/ui/data.pdf": pdfOf(RELEASE) });
    const out = await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 5, 13, 40), fetch: fetcher, db });
    expect(out.results.find((r) => r.source === "dol-claims")).toMatchObject({ ok: true, items: 0 });
    expect(events.get("dol:us_jobless_claims:2026-11-05")?.status).toBe("scheduled");
  });

  it("Census refusing (403): the error is logged, the other sources go on", async () => {
    const { db } = memoryDb(allEvents);
    const { fetcher } = network({});
    const out = await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 17, 13, 45), fetch: fetcher, db });
    expect(out.results.find((r) => r.source === "census-api")).toMatchObject({ ok: false, error: "HTTP 404 Census API us_retail_sales" });
    expect(out.results.find((r) => r.source === "bea-releases")).toBeDefined();
  });

  it("Census answering: the retail figure is saved", async () => {
    const { db, events } = memoryDb(allEvents);
    const json = [head, ["0.4", "MPCSM", "44X72", "yes", "2026-10", "1"], ["-0.2", "MPCSM", "44X72", "yes", "2026-09", "1"]];
    const { fetcher } = network({ "https://api.census.gov/data/timeseries/eits/marts": JSON.stringify(json) });
    await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 17, 13, 45), fetch: fetcher, db });
    expect(events.get("census:us_retail_sales:2026-11-17")).toMatchObject({ status: "released", actual: "+0.4%", previous: "−0.2%" });
  });
});
