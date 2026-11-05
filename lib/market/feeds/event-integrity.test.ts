import { describe, expect, it } from "vitest";
import { beaSchedule } from "./sources";
import { memoryFeedsDb } from "./memory-db";
import { icsCancellations, parseDtStart } from "./ics";
import { identity, previousPeriod, latestSchedules } from "./identity";
import { blsResults, BLS_SERIES } from "./bls";
import { parseEia, eiaResult } from "./eia";
import { eurostatJsonSchedule, parseEurostat, eurostatResult } from "./eurostat";
import { collectFeeds } from "./collect";
import type { EventResult } from "./types";
import { applyListedCorrections } from "./listed-corrections";
import { listedEvents } from "./schedules";

const now = Date.parse("2026-11-05T00:00:00Z");
const ics = (day = "20261110T133000Z", sequence = 1, status = "CONFIRMED", stage = "Second") => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:gdp-${stage}\nSUMMARY:Gross Domestic Product, 3rd Quarter 2026 (${stage} Estimate)\nDTSTART:${day}\nSEQUENCE:${sequence}\nSTATUS:${status}\nLAST-MODIFIED:20261105T000000Z\nEND:VEVENT\nEND:VCALENDAR`;
const base = () => beaSchedule(ics(), now)[0];
const result = (id: string, actual: string | null, version?: string): EventResult => ({ id, status: "released", actual, previous: "+2.0%", summary: null,
  result_meta: { period: "2026-Q3", series: "us_gdp", unit: "percent", adjustment: "SA", ...(version ? { source_updated: version } : {}) } });

describe("stable calendar identity and version ordering", () => {
  it("repeated schedules are idempotent, moves and time changes retain the original ID", async () => {
    const { db, events } = memoryFeedsDb();
    await db.upsertEvents([base(), base()]);
    await db.upsertEvents(beaSchedule(ics("20261111T150000Z", 2), now));
    expect(events.size).toBe(1);
    expect(events.get(base().id)).toMatchObject({ starts_at: "2026-11-11T15:00:00.000Z", identity_key: base().identity_key });
    await expect(db.upsertEvents([base()])).rejects.toThrow("schedule freshness unproven");
    expect(events.get(base().id)?.starts_at).toBe("2026-11-11T15:00:00.000Z");
  });
  it("explicit cancellation and newer restoration preserve published values", async () => {
    const { db, events } = memoryFeedsDb();
    await db.upsertEvents([base()]); await db.saveResults([result(base().id, "+3.0%")]);
    await db.upsertEvents(beaSchedule(ics(undefined, 2, "CANCELLED"), now));
    expect(events.get(base().id)).toMatchObject({ status: "cancelled", actual: "+3.0%" });
    await db.upsertEvents([]);
    expect(events.get(base().id)?.status).toBe("cancelled");
    await db.upsertEvents(beaSchedule(ics(undefined, 3), now));
    expect(events.get(base().id)).toMatchObject({ status: "released", actual: "+3.0%" });
  });
  it("restores the legacy publication state even when that legacy release had no numeric actual", async () => {
    const { db,events }=memoryFeedsDb({events:[base()]});
    events.set(base().id,{...events.get(base().id)!,status:"released"});
    await db.upsertEvents(beaSchedule(ics(undefined,2,"CANCELLED"),now));
    await db.upsertEvents(beaSchedule(ics(undefined,3),now));
    expect(events.get(base().id)?.status).toBe("released");
    expect(events.get(base().id)?.actual).toBeUndefined();
  });
  it("a cancellation notice can omit DTSTART; omission from a feed never cancels", () => {
    expect(icsCancellations("BEGIN:VEVENT\nUID:abc\nSTATUS:CANCELLED\nSEQUENCE:3\nEND:VEVENT")).toEqual([{ uid: "abc", meta: { cancelled: true, sequence: 3 } }]);
    expect(icsCancellations("BEGIN:VCALENDAR\nEND:VCALENDAR")).toEqual([]);
  });
  it("different countries, periods, indicators, UIDs and publication stages stay distinct", async () => {
    const keys = [identity("bea","us","gdp","2026-Q3","advance"), identity("bea","us","gdp","2026-Q3","second"), identity("bea","eu","gdp","2026-Q3","advance"), identity("bea","us","gdp","2026-Q4","advance"), identity("bea","us","pce","2026-Q3","advance"), identity("bea","us","gdp","2026-Q3","advance","another")];
    expect(new Set(keys).size).toBe(keys.length);
    const { db, events } = memoryFeedsDb();
    await db.upsertEvents([...beaSchedule(ics(undefined, 1, "CONFIRMED", "Advance"), now), base()]);
    expect(events.size).toBe(2);
  });
  it("a reviewed weekly move across weeks does not change the reference-week anchor", () => {
    const row = listedEvents().find((e) => e.id === "eia:us_eia_crude:2026-11-04")!;
    const moved = applyListedCorrections([row], { [row.id]: { starts_at:"2026-11-13T15:30:00Z",sequence:1,official_url:"https://www.eia.gov/petroleum/supply/weekly/" } })[0];
    expect(moved.id).toBe(row.id); expect(moved.identity_key).toBe(row.identity_key); expect(moved.reference_period).toBe("2026-10-30");
  });
  it("feed order cannot downgrade a sequence; equal conflicting versions are rejected", () => {
    const newer = beaSchedule(ics("20261111T150000Z", 2), now)[0];
    expect(latestSchedules([newer, base()])).toEqual([newer]);
    expect(() => latestSchedules([base(), { ...base(), starts_at: newer.starts_at }])).toThrow("inconsistent schedule version");
  });
  it("unambiguous legacy adoption keeps the ID; ambiguous duplicates remain untouched", async () => {
    const old = { ...base(), identity_key: null, source_uid: null, schedule_meta: undefined };
    const { db, events } = memoryFeedsDb({ events: [old, { ...old, id: "bea:duplicate" }] });
    const before = JSON.stringify([...events]);
    await expect(db.upsertEvents([base()])).rejects.toThrow("ambiguous legacy identity");
    expect(JSON.stringify([...events])).toBe(before);
    const clean = memoryFeedsDb({ events: [old] }); await clean.db.upsertEvents([base()]);
    expect(clean.events.size).toBe(1); expect(clean.events.get(old.id)?.identity_key).toBe(base().identity_key);
  });
});

describe("safe revisions and period arithmetic", () => {
  it("accepts a newer confirmed revision and rejects an older, unversioned or unit-mismatched response", async () => {
    const { db, events } = memoryFeedsDb({ events: [base()] });
    await db.setPrevious([{id:base().id,previous:"+1.0%"}]);
    await db.saveResults([{...result(base().id,null,"2026-11-10T13:30Z"),previous:"+9.0%"}]);
    expect(events.get(base().id)).toMatchObject({status:"scheduled",previous:"+1.0%"});
    await db.saveResults([result(base().id, "+3.0%", "2026-11-10T13:30Z")]);
    await db.saveResults([result(base().id, "+3.1%", "2026-11-11T13:30Z")]);
    for (const r of [result(base().id, "+3.0%", "2026-11-10T13:30Z"), result(base().id, "+3.2%"), { ...result(base().id, "+3.2%", "2026-11-12T13:30Z"), result_meta: { ...result(base().id, null).result_meta!, unit: "USD" } }]) await expect(db.saveResults([r])).rejects.toThrow("calendar conflict");
    expect(events.get(base().id)?.actual).toBe("+3.1%");
    await db.saveResults([result(base().id,"+3.1%")]);
    expect(events.get(base().id)?.result_meta?.source_updated).toBe("2026-11-11T13:30Z");
    await db.saveResults([{ ...result(base().id, null, "2026-11-11T13:30Z"), previous: null }]);
    expect(events.get(base().id)).toMatchObject({ actual: "+3.1%", previous: "+2.0%" });
  });
  it("missing months and missing stock values do not produce invented changes", () => {
    expect(blsResults(["bls:us_cpi:2026-11-10"], new Map([[BLS_SERIES.cpi, [{ period:"2026-10",value:110 },{ period:"2026-08",value:100 }]]]))).toEqual([]);
    expect(parseEia({ response: { data: [{ period:"2026-10-30",value:null },{ period:"2026-10-23",value:"" }] } })).toEqual([]);
    expect(eiaResult("eia:us_eia_crude:2026-11-04", [{ period:"2026-10-30",value:100 },{ period:"2026-10-16",value:90 }])).toBeNull();
    expect(previousPeriod("2026-01")).toBe("2025-12"); expect(previousPeriod("2026-Q1")).toBe("2025-Q4");
  });
  it("DST uses the source zone, preserves seconds, rejects invalid/floating and nonexistent times", () => {
    expect(parseDtStart("DTSTART;TZID=America/New_York:20260306T083015")).toBe(Date.parse("2026-03-06T13:30:15Z"));
    expect(parseDtStart("DTSTART;TZID=America/New_York:20260313T083000")).toBe(Date.parse("2026-03-13T12:30:00Z"));
    expect(parseDtStart("DTSTART;TZID=Europe/Luxembourg:20260401T110000")).toBe(Date.parse("2026-04-01T09:00:00Z"));
    expect(parseDtStart("DTSTART;TZID=America/New_York:20260308T023000")).toBeNull();
    expect(parseDtStart("DTSTART:20260230T110000Z")).toBeNull(); expect(parseDtStart("DTSTART:20261105T110000")).toBeNull();
  });
  it("database/read failures are isolated to the source before its job starts", async () => {
    const { db } = memoryFeedsDb();
    db.waitingEvents = async (source) => { if (source === "bls") throw new Error("migration 0012 missing"); return []; };
    const out = await collectFeeds({ scope:"releases", now, db, fetch:async () => ({ ok:false,status:503,text:async()=>"" }) });
    expect(out.results.find((r) => r.source === "bls-api")).toMatchObject({ ok:false,error:"migration 0012 missing" });
    expect(out.results.find((r) => r.source === "bea-releases")).toBeDefined();
  });
});

describe("Eurostat explicit metadata, never latest-period guessing", () => {
  const records = [{ recordid:"22494472", allDay:true, euroind:true, euroindAuthor:"estat", start:"2026-11-06T11:00Z", title:"Retail trade", period:"September 2026", datasetCodes:"sts_trtu_m,sts_trtu_q" }];
  const stat = { updated:"2026-11-06T10:00:00Z", id:["freq","geo","unit","s_adj","indic_bt","nace_r2","time"], size:[1,1,1,1,1,1,3], dimension:Object.fromEntries(Object.entries({ freq:["M"],geo:["EA21"],unit:["PCH_PRE"],s_adj:["SCA"],indic_bt:["VOL_SLS"],nace_r2:["G47"],time:["2026-08","2026-09","2026-10"] }).map(([k,v])=>[k,{category:{index:Object.fromEntries(v.map((x,i)=>[x,i]))}}])), value:{"0":0.1,"1":0,"2":99} };
  it("takes the reported period and recordid from the existing official calendar format", () => {
    expect(eurostatJsonSchedule(records,now)[0]).toMatchObject({ reference_period:"2026-09",source_uid:"recordid:22494472",starts_at:"2026-11-06T10:00:00.000Z",release_stage:"regular" });
    expect(eurostatJsonSchedule([{ ...records[0],period:"unknown" }],now)[0].reference_period).toBeNull();
  });
  it("takes an exact period including zero; rejects missing evidence, another country/unit and preliminary vintages", () => {
    const data = parseEurostat(stat);
    expect(eurostatResult("eurostat:eu_retail_sales:2026-11-06","2026-11-06T10:00:00Z",data,"2026-09")).toMatchObject({ actual:"+0.0%",previous:"+0.1%" });
    expect(eurostatResult("eurostat:eu_retail_sales:2026-11-06","2026-11-06T10:00:00Z",data)).toBeNull();
    expect(eurostatResult("eurostat:eu_retail_sales:2026-11-06","2026-11-06T10:00:00Z",{ ...data,geo:"EU27_2020" },"2026-09")).toBeNull();
    expect(eurostatResult("eurostat:eu_retail_sales:2026-11-06","2026-11-06T10:00:00Z",{ ...data,dimensions:{ ...data.dimensions,unit:["INDEX"] } },"2026-09")).toBeNull();
    expect(eurostatResult("eurostat:eu_gdp_prelim:2026-10-30","2026-10-30T10:00:00Z",data,"2026-Q3")).toBeNull();
  });
});
