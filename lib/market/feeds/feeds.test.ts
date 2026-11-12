import { describe, expect, it } from "vitest";
import { decodeEntities, plainText, text } from "./xml";
import { nyDay, parseRfc822, wallToUtc, NEW_YORK, FRANKFURT } from "./time";
import { parseIcs } from "./ics";
import {
  aboutMarkets,
  beaFigure,
  beaReleases,
  beaSchedule,
  cleanUrl,
  dedupeKey,
  ecbPress,
  fedMonetary,
  fedSpeeches,
  titleCase,
  whiteHouseActions,
  whiteHouseNews,
  whiteHouseTeaser,
  FED_CHAIR,
} from "./sources";
import { BLS_RELEASES, ECB_DECISIONS, FOMC_DECISIONS, lastListedDecision, listedEvents } from "./schedules";
import { blsResults, parseBlsResponse } from "./bls";

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;
const item = (o: { title: string; link: string; date: string; description?: string; categories?: string[]; guid?: string }) =>
  `<item><title>${o.title}</title><link><![CDATA[${o.link}]]></link>${o.guid ? `<guid isPermaLink="false">${o.guid}</guid>` : ""}${
    o.description ? `<description><![CDATA[${o.description}]]></description>` : ""
  }${(o.categories ?? []).map((c) => `<category><![CDATA[${c}]]></category>`).join("")}<pubDate>${o.date}</pubDate></item>`;

describe("feed basics", () => {
  it("decodes entities and CDATA, strips markup", () => {
    expect(decodeEntities("T&uuml;rkiye &amp; Board&#39;s &#8230;")).toBe("Türkiye & Board's …");
    expect(plainText("<![CDATA[<p>Real GDP &ndash; up</p>]]>")).toBe("Real GDP – up");
    expect(text("<item><title> Hi </title></item>", "title")).toBe("Hi");
  });

  it("reads every date form the official feeds use, as UTC", () => {
    expect(parseRfc822("Wed, 28 Oct 2026 18:00:00 GMT")).toBe(Date.UTC(2026, 9, 28, 18));
    expect(parseRfc822("Thu, 29 Oct 2026 14:15:00 +0100")).toBe(Date.UTC(2026, 9, 29, 13, 15));
    expect(parseRfc822("Tue, 03 Nov 2026 10:00:00 Z")).toBe(Date.UTC(2026, 10, 3, 10));
    expect(parseRfc822("Thu, 29 Oct 2026 08:30:00 EDT")).toBe(Date.UTC(2026, 9, 29, 12, 30));
    expect(parseRfc822("not a date")).toBeNull();
  });

  it("wall times of New York and Frankfurt follow summer time", () => {
    expect(wallToUtc("2026-11-06", "08:30", NEW_YORK)).toBe(Date.UTC(2026, 10, 6, 13, 30)); // EST
    expect(wallToUtc("2027-07-02", "08:30", NEW_YORK)).toBe(Date.UTC(2027, 6, 2, 12, 30)); // EDT
    expect(wallToUtc("2026-12-17", "14:15", FRANKFURT)).toBe(Date.UTC(2026, 11, 17, 13, 15)); // CET
    expect(wallToUtc("2027-07-22", "14:15", FRANKFURT)).toBe(Date.UTC(2027, 6, 22, 12, 15)); // CEST
    expect(nyDay(Date.UTC(2026, 10, 7, 3))).toBe("2026-11-06");
  });

  it("reads .ics in UTC, with a time zone id, and folded lines", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Gross Domestic Product\\, 4th Quarter and Year 2024 (Advance Estima",
      " te)",
      "DTSTART;VALUE=DATE-TIME:20250130T133000Z",
      "UID:a",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Employment Situation",
      "DTSTART;TZID=US-Eastern:20250110T083000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Floating",
      "DTSTART:20250110T083000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics);
    expect(events).toEqual([
      { summary: "Gross Domestic Product, 4th Quarter and Year 2024 (Advance Estimate)", start: Date.UTC(2025, 0, 30, 13, 30), uid: "a" },
      { summary: "Employment Situation", start: Date.UTC(2025, 0, 10, 13, 30), uid: null },
    ]);
  });

  it("keeps only https links; fixes the ECB's double slash and BEA's missing scheme", () => {
    expect(cleanUrl("https://www.ecb.europa.eu//press/key/x.html")).toBe("https://www.ecb.europa.eu/press/key/x.html");
    expect(cleanUrl("www.bea.gov/news/x")).toBe("https://www.bea.gov/news/x");
    expect(cleanUrl("http://www.boj.or.jp/en/x.pdf")).toBe("https://www.boj.or.jp/en/x.pdf");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
  });

  it("one story from two feeds shares a key", () => {
    const at = Date.UTC(2026, 9, 28, 18);
    expect(dedupeKey("fed", "Federal Reserve issues FOMC statement", at)).toBe("fed:federal-reserve-issues-fomc-statement:2026-10-28");
    expect(dedupeKey("fed", "Federal Reserve issues FOMC statement!", at)).toBe(dedupeKey("fed", "federal reserve issues fomc statement", at));
  });
});

describe("sources: importance and noise", () => {
  it("Fed: the FOMC statement is high and linked to its decision; discount rate minutes are low; the description that repeats the title is dropped", () => {
    const xml = rss(
      item({ title: "Federal Reserve issues FOMC statement", link: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261209a.htm", date: "Wed, 09 Dec 2026 19:00:00 GMT", description: "Federal Reserve issues FOMC statement" }) +
        item({ title: "Minutes of the Board&#39;s discount rate meeting on April 20 and 29, 2026", link: "https://www.federalreserve.gov/x.htm", date: "Tue, 26 May 2026 18:00:00 GMT" }) +
        item({ title: "Minutes of the Federal Open Market Committee, December 8-9, 2026", link: "https://www.federalreserve.gov/y.htm", date: "Wed, 30 Dec 2026 19:00:00 GMT" })
    );
    const [statement, discount, minutes] = fedMonetary(xml);
    expect(statement).toMatchObject({ kind: "decision", importance: 3, event_id: "fed:fomc:2026-12-09:decision", summary: null, trust: "official" });
    expect(discount).toMatchObject({ kind: "minutes", importance: 1 });
    expect(minutes).toMatchObject({ kind: "minutes", importance: 2, event_id: "fed:fomc:2026-12-09:minutes" });
  });

  it("Fed speeches: the Chair and the policy report are high, money topics medium, the rest low", () => {
    const xml = rss(
      item({ title: `${FED_CHAIR}, Economic Outlook`, link: "https://www.federalreserve.gov/a.htm", date: "Thu, 15 Oct 2026 14:00:00 GMT" }) +
        item({ title: "Jefferson, The U.S. Economy and Monetary Policy", link: "https://www.federalreserve.gov/b.htm", date: "Thu, 15 Oct 2026 15:00:00 GMT" }) +
        item({ title: "Bowman, Opening Remarks", link: "https://www.federalreserve.gov/c.htm", date: "Thu, 15 Oct 2026 16:00:00 GMT" }) +
        item({ title: "Powell, Semiannual Monetary Policy Report to the Congress", link: "https://www.federalreserve.gov/d.htm", date: "Thu, 15 Oct 2026 17:00:00 GMT" })
    );
    expect(fedSpeeches(xml, "speech").map((n) => n.importance)).toEqual([3, 2, 1, 3]);
  });

  it("ECB: the decision and the press conference are high, the President's speech high, a press release low", () => {
    const xml = rss(
      item({ title: " Monetary policy decisions", link: "https://www.ecb.europa.eu//press/pr/1.html", date: "Thu, 29 Oct 2026 14:15:00 +0100" }) +
        item({ title: " Christine Lagarde, Boris Vujčić: Monetary policy statement (with Q&amp;A)", link: "https://www.ecb.europa.eu/press/2.html", date: "Thu, 29 Oct 2026 15:00:00 +0100" }) +
        item({ title: " Christine Lagarde: Europe in a changing world", link: "https://www.ecb.europa.eu/press/3.html", date: "Thu, 29 Oct 2026 16:00:00 +0100" }) +
        item({ title: " Philip R. Lane: AI adoption in Europe", link: "https://www.ecb.europa.eu/press/4.html", date: "Thu, 29 Oct 2026 17:00:00 +0100" }) +
        item({ title: " October 2026 euro area bank lending survey", link: "https://www.ecb.europa.eu/press/5.html", date: "Thu, 29 Oct 2026 18:00:00 +0100" })
    );
    const rows = ecbPress(xml);
    expect(rows.map((r) => [r.kind, r.importance])).toEqual([
      ["decision", 3],
      ["press_conference", 3],
      ["speech", 3],
      ["speech", 1],
      ["press_release", 1],
    ]);
    expect(rows[0]).toMatchObject({ title: "Monetary policy decisions", url: "https://www.ecb.europa.eu/press/pr/1.html", published_at: "2026-10-29T13:15:00.000Z" });
  });

  it("White House: tariffs and sanctions are shown (high), ceremonies and general texts are hidden; the teaser loses WordPress's tail", () => {
    const teaser = "<p>BY THE PRESIDENT A PROCLAMATION 1. Imports of robotics [&#8230;]</p><p>The post <a href='x'>X</a> appeared first on <a href='y'>The White House</a>.</p>";
    const xml = rss(
      item({ title: "ADJUSTING IMPORTS OF ROBOTICS INTO THE UNITED STATES", link: "https://www.whitehouse.gov/presidential-actions/2026/10/a/", date: "Wed, 28 Oct 2026 20:03:48 +0000", description: teaser, guid: "https://www.whitehouse.gov/?p=1" }) +
        item({ title: "National Seafood Month, 2026", link: "https://www.whitehouse.gov/presidential-actions/2026/10/b/", date: "Wed, 28 Oct 2026 20:00:00 +0000", description: "the seafood economy and trade" }) +
        item({ title: "Eliminating Disease-Carrying Pests", link: "https://www.whitehouse.gov/presidential-actions/2026/10/c/", date: "Wed, 28 Oct 2026 19:00:00 +0000", description: "for the economy and investment" }) +
        item({ title: "Emergency Tax Relief on Diesel Fuel", link: "https://www.whitehouse.gov/presidential-actions/2026/10/d/", date: "Wed, 28 Oct 2026 18:00:00 +0000" })
    );
    const rows = whiteHouseActions(xml);
    expect(rows.map((r) => [r.hidden, r.importance])).toEqual([
      [false, 3],
      [true, 2],
      [true, 2],
      [false, 2],
    ]);
    expect(rows[0].title).toBe("Adjusting imports of robotics into the united states");
    expect(rows[0].summary).toBe("BY THE PRESIDENT A PROCLAMATION 1. Imports of robotics …");
    expect(rows[0].id).toBe("whitehouse:www.whitehouse.gov/?p=1");
  });

  it("White House news: only «Briefings & Statements» about markets", () => {
    const xml = rss(
      item({ title: "Statement on new tariffs on steel", link: "https://www.whitehouse.gov/briefings-statements/a/", date: "Wed, 28 Oct 2026 20:00:00 +0000", categories: ["Briefings & Statements"] }) +
        item({ title: "President Trump Unleashes the American Economy", link: "https://www.whitehouse.gov/releases/b/", date: "Wed, 28 Oct 2026 20:00:00 +0000", categories: ["Releases"] }) +
        item({ title: "Presidential Message on All Saints’ Day", link: "https://www.whitehouse.gov/briefings-statements/c/", date: "Wed, 28 Oct 2026 20:00:00 +0000", categories: ["Briefings & Statements"] })
    );
    expect(whiteHouseNews(xml).map((r) => r.hidden)).toEqual([false, true, true]);
    expect(aboutMarkets("Columbus Day, 2026", "tariffs")).toBe(false);
    expect(whiteHouseTeaser(null)).toBeNull();
    expect(titleCase("Mixed Case Title")).toBe("Mixed Case Title");
  });

  it("BEA: main releases from the .ics (GDP, PCE, trade), not «GDP by County»; one row per id; only near dates", () => {
    const now = Date.UTC(2026, 10, 3);
    const ics = [
      "BEGIN:VEVENT", "SUMMARY:GDP (Second Estimate) and Corporate Profits\\, 3rd Quarter 2026", "DTSTART:20261125T133000Z", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:GDP (Second Estimate) and Corporate Profits\\, 3rd Quarter 2026", "DTSTART:20261125T133000Z", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:GDP by County and Personal Income by County\\, 2025", "DTSTART:20261202T133000Z", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Personal Income and Outlays\\, October 2026", "DTSTART:20261125T133000Z", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:U.S. International Trade in Goods and Services\\, September 2026", "DTSTART:20261104T133000Z", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:GDP (Advance Estimate)\\, 4th Quarter 2024", "DTSTART:20250130T133000Z", "END:VEVENT",
    ].join("\n");
    const rows = beaSchedule(ics, now);
    expect(rows.map((r) => [r.id, r.importance])).toEqual([
      ["bea:us_gdp:2026-11-25", 3],
      ["bea:gdp-by-county-and-personal-income-by-county-2025:2026-12-02", 1],
      ["bea:us_pce:2026-11-25", 3],
      ["bea:us_trade:2026-11-04", 2],
    ]);
    expect(rows[0].starts_at).toBe("2026-11-25T13:30:00.000Z");
  });

  it("BEA: each release is news, and its figure goes to the calendar event", () => {
    const xml = `<rss><channel><item name="GDP"><title>GDP (Advance Estimate), 3rd Quarter 2026</title><link>https://www.bea.gov/news/2026/gdp</link><guid isPermaLink="true">https://www.bea.gov/news/2026/gdp</guid><description><![CDATA[<p>Real GDP increased at an annual rate of 3.4 percent.</p>]]></description><data><main><current><infoDate>Q3 2026</infoDate><percentChange>+3.4</percentChange></current><previous><infoDate>Q2 2026</infoDate><percentChange>2.2%</percentChange></previous></main></data><pubDate>Thu, 29 Oct 2026 08:30:00 EDT</pubDate></item></channel></rss>`;
    const { news, results } = beaReleases(xml);
    expect(news[0]).toMatchObject({ source: "bea", kind: "data", importance: 3, event_id: "bea:us_gdp:2026-10-29", summary: "Real GDP increased at an annual rate of 3.4 percent.", published_at: "2026-10-29T12:30:00.000Z" });
    expect(results).toMatchObject([{ id: "bea:us_gdp:2026-10-29", status: "released", actual: "+3.4%", previous: "+2.2%", summary: "Real GDP increased at an annual rate of 3.4 percent." }]);
    expect(beaFigure(null)).toBeNull();
    // the trade balance is an amount (BEA's feed of 4 November 2026), not a percent
    expect(beaFigure("<current><percentChange>-$105.0 billion</percentChange></current>")).toBe("−$105.0B");
    expect(beaFigure("<previous><percentChange>-$105.7 billion</percentChange></previous>")).toBe("−$105.7B");
  });
});

describe("listed schedules", () => {
  it("FOMC: statement 2:00 p.m. and press conference 2:30 p.m. ET, minutes three weeks later; ECB at 14:15 / 14:45 Frankfurt", () => {
    const byId = new Map(listedEvents().map((e) => [e.id, e]));
    expect(byId.get("fed:fomc:2026-12-09:decision")).toMatchObject({ starts_at: "2026-12-09T19:00:00.000Z", importance: 3, title: "FOMC statement and Summary of Economic Projections" });
    expect(byId.get("fed:fomc:2026-12-09:press")?.starts_at).toBe("2026-12-09T19:30:00.000Z");
    expect(byId.get("fed:fomc:2026-12-09:minutes")?.starts_at).toBe("2026-12-30T19:00:00.000Z");
    expect(byId.get("fed:fomc:2027-01-27:decision")?.title).toBe("FOMC statement");
    expect(byId.get("ecb:mpm:2027-07-22:decision")?.starts_at).toBe("2027-07-22T12:15:00.000Z");
    expect(byId.get("ecb:mpm:2027-07-22:press")?.starts_at).toBe("2027-07-22T12:45:00.000Z");
    expect(byId.get("bls:us_nfp:2026-11-06")).toMatchObject({ starts_at: "2026-11-06T13:30:00.000Z", importance: 3, code: "us_nfp" });
    expect(byId.get("bls:us_jolts:2026-12-01")?.starts_at).toBe("2026-12-01T15:00:00.000Z");
  });

  it("eight FOMC and eight ECB decisions a year; every listed BLS day is a weekday", () => {
    expect(FOMC_DECISIONS.filter((d) => d.startsWith("2027"))).toHaveLength(8);
    expect(ECB_DECISIONS.filter((d) => d.startsWith("2027"))).toHaveLength(8);
    for (const r of Object.values(BLS_RELEASES)) for (const day of Object.keys(r.dates)) expect([0, 6]).not.toContain(new Date(`${day}T12:00:00Z`).getUTCDay());
  });

  // A reminder, on purpose: when this fails, add next year's FOMC, ECB and BLS dates from their official pages.
  it("the listed decisions reach at least two months ahead", () => {
    expect(Date.parse(lastListedDecision())).toBeGreaterThan(Date.now() + 60 * 86_400_000);
  });
});

describe("BLS figures from the official API", () => {
  const api = (series: Record<string, [string, string, string][]>) => ({
    status: "REQUEST_SUCCEEDED",
    Results: { series: Object.entries(series).map(([seriesID, data]) => ({ seriesID, data: data.map(([year, period, value]) => ({ year, period, value })) })) },
  });

  it("payrolls change and the unemployment rate; latest CPI is excluded; nothing before the reference month is out", () => {
    const data = parseBlsResponse(
      api({
        CES0000000001: [["2026", "M10", "159073"], ["2026", "M09", "159044"], ["2026", "M08", "159015"]],
        LNS14000000: [["2026", "M10", "4.3"]],
        CUSR0000SA0: [["2026", "M10", "330.990"], ["2026", "M09", "330.000"], ["2026", "M08", "329.010"]],
        WPSFD4: [["2026", "M09", "150.0"]],
        JTS000000000000000JOL: [["2026", "M09", "7520"], ["2026", "M08", "7190"]],
      })
    );
    expect(blsResults(["bls:us_nfp:2026-11-06", "bls:us_cpi:2026-11-10", "bls:us_ppi:2026-11-13", "bls:us_jolts:2026-11-03"], data)).toMatchObject([
      { id: "bls:us_nfp:2026-11-06", status: "released", actual: "+29K · 4.3%", previous: "+29K", summary: null },
    ]);
  });
});
