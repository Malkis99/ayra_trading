import { describe, expect, it } from "vitest";
import { EUROSTAT_ICS, eurostatResult, eurostatSchedule, eurostatUrl, parseEurostat } from "./eurostat";
import { parseIcs, parseIcsDays } from "./ics";
import { collectFeeds, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import type { EventRow } from "./types";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { en } from "@/lib/i18n/dictionaries/en";

// Eurostat's iCal of 2026-11-04 (category «Euro indicator release»), trimmed: all-day entries with escaped commas
const vevent = (day: string, summary: string) => `BEGIN:VEVENT\r\nDTSTAMP:20261104T071118Z\r\nDTSTART;VALUE=DATE:${day}\r\nSUMMARY:${summary}\r\nX-CATEGORY:Data release\\,Euro indicators release\r\nUID:20270104T231750Z-1@paloontrar.cc.cec.eu.int\r\nEND:VEVENT`;
const ICS = [
  "BEGIN:VCALENDAR\r\nPRODID:-//Eurostat//Euro indicators release calendar//EN\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Luxembourg\r\nBEGIN:DAYLIGHT\r\nDTSTART:19810329T020000\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE",
  vevent("20261030", "Preliminary flash estimate GDP - EU and euro area"),
  vevent("20261030", "Unemployment"),
  vevent("20261104", "Flash estimate inflation euro area"),
  vevent("20261105", "Industrial producer prices\\, domestic market"),
  vevent("20261106", "Retail trade"),
  vevent("20261113", "Flash estimate GDP and employment - EU and euro area"),
  vevent("20261118", "Inflation (HICP)"),
  vevent("20260602", "Flash estimate inflation euro area"),
  vevent("20270602", "Flash estimate inflation euro area"),
  "END:VCALENDAR",
].join("\r\n");

const NOW = Date.UTC(2026, 10, 4, 7, 0); // Wednesday 4 November, before the 11:00 CET release

describe("Eurostat's release calendar (iCal, Euro indicators)", () => {
  it("all-day entries are read with their day; the timed reader leaves them out", () => {
    expect(parseIcsDays(ICS)).toContainEqual({ summary: "Industrial producer prices, domestic market", day: "2026-11-05" });
    expect(parseIcs(ICS)).toEqual([]);
  });

  it("our five releases at 11:00 Luxembourg time in UTC (10:00 in winter, 09:00 in summer); the rest left out", () => {
    const rows = eurostatSchedule(ICS, NOW);
    expect(rows.map((r) => [r.id, r.starts_at, r.importance])).toEqual([
      ["eurostat:eu_gdp_prelim:2026-10-30", "2026-10-30T10:00:00.000Z", 3],
      ["eurostat:eu_unemployment:2026-10-30", "2026-10-30T10:00:00.000Z", 2],
      ["eurostat:eu_hicp_flash:2026-11-04", "2026-11-04T10:00:00.000Z", 3],
      ["eurostat:eu_retail_sales:2026-11-06", "2026-11-06T10:00:00.000Z", 2],
      ["eurostat:eu_gdp_flash:2026-11-13", "2026-11-13T10:00:00.000Z", 2],
      ["eurostat:eu_hicp_flash:2027-06-02", "2027-06-02T09:00:00.000Z", 3],
    ]);
    for (const r of rows) expect(r).toMatchObject({ source: "eurostat", country: "eu", kind: "release", url: "https://ec.europa.eu/eurostat/news/euro-indicators", time_tbd: false });
  });

  it("the calendar's own address (the «Copy calendar URL» of Eurostat's page)", () => {
    expect(EUROSTAT_ICS).toBe("https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=2");
  });

  it("the dictionary names every Eurostat release and the source in Russian and English, with the credit", () => {
    for (const code of ["eu_hicp_flash", "eu_gdp_prelim", "eu_gdp_flash", "eu_unemployment", "eu_retail_sales"]) {
      expect((ru.market.calendar.own.events as Record<string, string>)[code]).toBeTruthy();
      expect((en.market.calendar.own.events as Record<string, string>)[code]).toBeTruthy();
    }
    expect(ru.market.calendar.own.sources.eurostat).toBe("Eurostat");
    expect(ru.market.calendar.own.sourcesLine).toContain("источник — Eurostat");
    expect(en.market.calendar.own.sourcesLine).toContain("source — Eurostat");
  });
});

/** Eurostat's JSON-stat 2.0 answer (the API of 2026-11-04, trimmed to what is read). */
const stat = (o: { updated: string; geo: string; times: string[]; values: Record<string, number> }) => ({
  version: "2.0",
  class: "dataset",
  updated: o.updated,
  id: ["freq", "unit", "geo", "time"],
  size: [1, 1, 1, o.times.length],
  value: o.values,
  dimension: {
    freq: { category: { index: { M: 0 } } },
    unit: { category: { index: { PC_ACT: 0 } } },
    geo: { category: { index: { [o.geo]: 0 } } },
    time: { category: { index: Object.fromEntries(o.times.map((t, i) => [t, i])) } },
  },
});
const UNEMPLOYMENT = stat({ updated: "2026-10-30T11:00:00+0100", geo: "EA21", times: ["2026-07", "2026-08", "2026-09"], values: { "0": 6.4, "1": 6.5, "2": 6.5 } });
const RETAIL = stat({ updated: "2026-11-03T11:00:00+0100", geo: "EA21", times: ["2026-07", "2026-08", "2026-09"], values: { "0": -0.6, "1": 0.1 } });

describe("Eurostat figures (dissemination API, JSON-stat)", () => {
  it("the euro area's newest values, and when the dataset was updated", () => {
    expect(parseEurostat(UNEMPLOYMENT)).toEqual({ updated: Date.parse("2026-10-30T10:00:00Z"), latest: "2026-09", values: [{ period: "2026-09", value: 6.5 }, { period: "2026-08", value: 6.5 }, { period: "2026-07", value: 6.4 }] });
  });

  it("a figure once the dataset was updated with the release: rates as they are, changes with a sign", () => {
    expect(eurostatResult("eurostat:eu_unemployment:2026-10-30", "2026-10-30T10:00:00.000Z", parseEurostat(UNEMPLOYMENT))).toEqual({ id: "eurostat:eu_unemployment:2026-10-30", status: "released", actual: "6.5%", previous: "6.5%", summary: null });
    const gdp = stat({ updated: "2026-10-30T11:00:00+0100", geo: "EA", times: ["2026-Q2", "2026-Q3"], values: { "0": 0.6, "1": -0.2 } });
    expect(eurostatResult("eurostat:eu_gdp_prelim:2026-10-30", "2026-10-30T10:00:00.000Z", parseEurostat(gdp))).toMatchObject({ actual: "−0.2%", previous: "+0.6%" });
  });

  it("nothing while the dataset still has the old data (updated before the release)", () => {
    expect(eurostatResult("eurostat:eu_unemployment:2026-12-02", "2026-12-02T10:00:00.000Z", parseEurostat(UNEMPLOYMENT))).toBeNull();
  });

  it("nothing while the newest month has some countries but not the euro area (retail on 4 November)", () => {
    expect(eurostatResult("eurostat:eu_retail_sales:2026-11-03", "2026-11-03T10:00:00.000Z", parseEurostat(RETAIL))).toBeNull();
  });

  it("any other answer gives nothing", () => {
    expect(parseEurostat({ error: [{ status: 404 }] }).values).toEqual([]);
    expect(parseEurostat(stat({ updated: "2026-10-30T11:00:00+0100", geo: "EU27_2020", times: ["2026-09"], values: { "0": 5.9 } })).values).toEqual([]);
  });

  it("asks the headline series of the euro area: EA, or today's EA21", () => {
    const u = new URL(eurostatUrl("eu_hicp_flash"));
    expect(u.pathname).toBe("/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr");
    expect(u.searchParams.getAll("geo")).toEqual(["EA", "EA21"]);
    expect(u.searchParams.get("unit")).toBe("RCH_A");
    expect(new URL(eurostatUrl("eu_retail_sales")).searchParams.get("indic_bt")).toBe("VOL_SLS");
  });
});

const memoryDb = (rows: EventRow[] = []) => memoryFeedsDb({ events: rows });

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

describe("the collector and Eurostat", () => {
  it("schedules: the iCal becomes calendar rows; logged as «eurostat-schedule»", async () => {
    const { db, events, runs } = memoryDb();
    const { fetcher } = network({ [EUROSTAT_ICS]: ICS });
    await collectFeeds({ scope: "schedules", now: NOW, fetch: fetcher, db });
    expect(events.get("eurostat:eu_hicp_flash:2026-11-04")?.starts_at).toBe("2026-11-04T10:00:00.000Z");
    expect(runs.find((r) => r.source === "eurostat-schedule")).toMatchObject({ ok: true, items: 6 });
  });

  it("after a release: the API is asked once per dataset and the figure saved", async () => {
    const { db, events } = memoryDb(eurostatSchedule(ICS, NOW));
    const { fetcher, asked } = network({ "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m": JSON.stringify(UNEMPLOYMENT) });
    await collectFeeds({ scope: "releases", now: Date.UTC(2026, 9, 30, 10, 15), fetch: fetcher, db });
    expect(events.get("eurostat:eu_unemployment:2026-10-30")).toMatchObject({ status: "released", actual: "6.5%", previous: "6.5%" });
    expect(asked.filter((u) => u.includes("namq_10_gdp"))).toHaveLength(1); // the GDP release the same morning
    expect(asked.filter((u) => u.includes("une_rt_m"))).toHaveLength(1);
  });

  it("before a release nothing is asked for it; a release of the last week without a figure is caught up", async () => {
    const future = memoryDb(eurostatSchedule(ICS, NOW).filter((r) => r.starts_at > new Date(NOW).toISOString()));
    const a = network({});
    await collectFeeds({ scope: "releases", now: NOW, fetch: a.fetcher, db: future.db });
    expect(a.asked.some((u) => u.includes("eurostat/api"))).toBe(false);

    // 4 November: unemployment of 30 October has no figure yet (the collector was not there) — it is asked again
    const { db, events } = memoryDb(eurostatSchedule(ICS, NOW));
    const b = network({ "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m": JSON.stringify(UNEMPLOYMENT) });
    await collectFeeds({ scope: "releases", now: NOW, fetch: b.fetcher, db });
    expect(events.get("eurostat:eu_unemployment:2026-10-30")).toMatchObject({ status: "released", actual: "6.5%" });
  });
});
