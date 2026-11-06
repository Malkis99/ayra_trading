import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isPpiCode, parsePpiRelease, PPI_METRICS, ppiReleaseUrl, ppiResults, PPI_SCHEDULE_URL } from "./ppi";
import { ppiSchedule } from "./bls-schedule";
import { collectFeeds, type Fetcher } from "./collect";
import { memoryFeedsDb } from "./memory-db";
import { listedEvents } from "./schedules";
import { blsLatest, blsResults } from "./bls";
import { scheduleIdentity } from "./identity";
import { applyListedCorrections } from "./listed-corrections";

const releaseHtml = readFileSync("lib/market/feeds/fixtures/ppi-2026-10-15.html","utf8");
const scheduleHtml = readFileSync("lib/market/feeds/fixtures/ppi-schedule-2026-11-06.html","utf8");
const release = () => parsePpiRelease(releaseHtml,"2026-10-15");
const rows = () => ppiSchedule(scheduleHtml);
const now = Date.parse("2026-11-06T12:00Z");
const septemberRows = () => rows().slice(0,4).map(e => scheduleIdentity({...e,id:e.id.replace("2026-11-13","2026-10-15"),starts_at:"2026-10-15T12:30:00Z"},"2026-09","regular",null,{}));
const network = (pages: Record<string,string>, status = 200) => {
  const asked: string[] = [];
  const fetch: Fetcher = async url => { asked.push(url); return {ok:status===200 && !!pages[url],status: pages[url] ? status : 404,text:async()=>pages[url] || ""}; };
  return {asked,fetch};
};
describe("PPI published release", () => {
  it("reads four official percentages, not goods-only or the trade-services exclusion", () => {
    expect(release()).toMatchObject({period:"2026-09",published:"2026-10-15T12:30:00.000Z",values:{
      us_ppi:{actual:"+1.3%",previous:"+0.5%"},us_ppi_yoy:{actual:"6.3%",previous:"5.6%"},
      us_core_ppi:{actual:"+0.7%",previous:"+0.2%"},us_core_ppi_yoy:{actual:"5.0%",previous:null},
    }});
  });
  it("rejects wrong date, period, adjustment, grouping and absent preliminary proof", () => {
    expect(()=>parsePpiRelease(releaseHtml,"2026-10-16")).toThrow("release date");
    expect(()=>parsePpiRelease(releaseHtml.replace("[September 2026]","[August 2026]"),"2026-10-15")).toThrow("table period");
    expect(()=>parsePpiRelease(releaseHtml.replace("Unadjusted 12-month percent change","Index level"),"2026-10-15")).toThrow("adjustment");
    expect(()=>parsePpiRelease(releaseHtml.replace("<td>49104</td>","<td>49116</td>"),"2026-10-15")).toThrow("grouping");
    expect(()=>parsePpiRelease(releaseHtml.replaceAll("<sup>(p)</sup>",""),"2026-10-15")).toThrow("preliminary");
    expect(()=>parsePpiRelease("<html>Access Denied</html>","2026-10-15")).toThrow("not verified");
  });
  it("preserves missing values as null and will not manufacture current-series PPI", () => {
    expect(parsePpiRelease(releaseHtml.replace("<td>1.3</td>","<td>-</td>"),"2026-10-15").values.us_ppi.actual).toBeNull();
    expect(blsResults(["bls:us_ppi:2026-11-13"],new Map())).toEqual([]);
    expect(blsLatest(new Map()).has("us_ppi")).toBe(false);
    expect(ppiResults(rows(),release())).toEqual([]); // the fixture schedule starts at October, not September
  });
  it("records four facts once and carries only a proven initial Core annual previous with its origin", async () => {
    const events = septemberRows();
    const memory = memoryFeedsDb({events});
    const previous = {...events[3],id:"bls:us_core_ppi_yoy:2026-09-10",identity_key:null,reference_period:"2026-08",starts_at:"2026-09-10T12:30Z",status:"released" as const,actual:"4.6%",result_meta:{period:"2026-08",series:"FD49104",unit:"percent-yoy",adjustment:"NSA",source_updated:"2026-09-10T12:30:00Z",release_url:ppiReleaseUrl("2026-09-10"),vintage:"release" as const,estimate_status:"preliminary" as const}};
    memory.events.set(previous.id,previous);
    const net = network({[ppiReleaseUrl("2026-10-15")]:releaseHtml});
    await collectFeeds({scope:"releases",now:Date.parse("2026-10-15T12:45Z"),db:memory.db,fetch:net.fetch});
    await collectFeeds({scope:"releases",now:Date.parse("2026-10-15T12:46Z"),db:memory.db,fetch:net.fetch});
    expect(net.asked.filter(u=>u.includes("bls.gov"))).toEqual([ppiReleaseUrl("2026-10-15")]);
    expect(events.every(e=>memory.events.get(e.id)?.status==="released")).toBe(true);
    expect(memory.events.get(events[3].id)).toMatchObject({previous:"4.6%",result_meta:{previous_source:{period:"2026-08",release_url:previous.result_meta.release_url,basis:"initial-prior-release"}}});
    expect(memory.events.get(previous.id)?.actual).toBe("4.6%");
  });
  it("does not use legacy API previous, overwrite an old fact, or confuse changed delivery dates with IDs", async () => {
    const events = septemberRows().map(e=>({...e,id:e.id.replace("2026-10-15","2026-10-14")})); // moved: original ID, official publication on Oct15
    const memory = memoryFeedsDb({events});
    const legacy = memory.events.get(events[0].id)!;
    memory.events.set(legacy.id,{...legacy,status:"released",actual:"+1.2%",previous:"+0.4%"});
    const net = network({[ppiReleaseUrl("2026-10-15")]:releaseHtml});
    await collectFeeds({scope:"releases",now:Date.parse("2026-10-15T12:45Z"),db:memory.db,fetch:net.fetch});
    expect(memory.events.get(legacy.id)).toMatchObject({actual:"+1.2%",previous:"+0.4%"});
    expect(memory.events.get(events[3].id)).toMatchObject({status:"released",actual:"5.0%"});
    expect(memory.events.get(events[3].id)?.previous).toBeUndefined();
    expect(net.asked.filter(u=>u.includes("bls.gov"))).toEqual([ppiReleaseUrl("2026-10-15")]);
  });
  it("a blocked PPI release shares the BLS retry budget and does not starve the other BLS batch", async () => {
    const events = septemberRows();
    const api = scheduleIdentity({...events[0],id:"bls:us_nfp:2026-10-15",code:"us_nfp",title:"Employment Situation"},"2026-09","regular",null,{});
    const memory = memoryFeedsDb({events:[...events,api]});
    const net = network({[ppiReleaseUrl("2026-10-15")]:"Access Denied"},403);
    const at = Date.parse("2026-10-15T12:45Z");
    await collectFeeds({scope:"releases",now:at,db:memory.db,fetch:net.fetch});
    await collectFeeds({scope:"releases",now:at+60_000,db:memory.db,fetch:net.fetch});
    expect(net.asked.filter(u=>u.includes("bls.gov"))).toHaveLength(1);
    await collectFeeds({scope:"releases",now:at+11*60_000,db:memory.db,fetch:net.fetch});
    expect(net.asked.filter(u=>u.includes("bls.gov"))[1]).toContain("api.bls.gov");
    expect(events.every(e=>memory.events.get(e.id)?.status==="scheduled")).toBe(true);
  });
  it("times out a stalled HTML body, aborts the request and continues the remaining sources", async () => {
    vi.useFakeTimers();
    try {
      // Synthetic second source only verifies isolation after the stalled PPI request.
      const dol = {...septemberRows()[0],id:"dol:us_jobless_claims:2026-10-15",source:"dol" as const,code:"us_jobless_claims",reference_period:"2026-10-09",identity_key:null};
      const memory = memoryFeedsDb({events:[...septemberRows(),dol]});
      let signal: AbortSignal | undefined;
      const fetch: Fetcher = async (url,init) => {
        if (url===ppiReleaseUrl("2026-10-15")) { signal=init?.signal; return {ok:true,status:200,text:()=>new Promise<string>(()=>{})}; }
        return {ok:false,status:404,text:async()=>""};
      };
      const pending = collectFeeds({scope:"releases",now:Date.parse("2026-10-15T12:45Z"),db:memory.db,fetch});
      await vi.advanceTimersByTimeAsync(15_001);
      const result = await pending;
      expect(signal?.aborted).toBe(true);
      expect(result.results.find(r=>r.source==="bls-ppi-release")).toMatchObject({ok:false,error:"timeout"});
      expect(result.results.find(r=>r.source==="dol-claims")).toMatchObject({ok:false});
    } finally { vi.useRealTimers(); }
  });
  it("a reviewed cancellation/restoration affects all four indicators without changing identities", async () => {
    const events = septemberRows().map(e=>({...e,schedule_meta:{sequence:0}})); // reviewed-list bootstrap baseline
    const memory = memoryFeedsDb({events});
    const correction = (cancelled:boolean,sequence:number) => applyListedCorrections(events,{[events[0].id]:{cancelled,sequence,official_url:"https://www.bls.gov/"}});
    await memory.db.upsertEvents(correction(true,1));
    expect([...memory.events.values()].every(e=>e.status==="cancelled")).toBe(true);
    await memory.db.upsertEvents(correction(false,2));
    expect([...memory.events.values()].every(e=>e.status==="scheduled")).toBe(true);
    expect([...memory.events.keys()]).toEqual(events.map(e=>e.id));
  });
});
describe("PPI official future schedule", () => {
  it("imports fourteen real future releases into 56 distinct indicators, including year boundary and DST", () => {
    expect(rows()).toHaveLength(56);
    expect(new Set(rows().map(e=>e.identity_key)).size).toBe(56);
    for (const [day,period] of [["2026-11-13","2026-10"],["2026-12-15","2026-11"],["2027-01-14","2026-12"],["2027-02-12","2027-01"],["2027-12-15","2027-11"]]) {
      const group = rows().filter(e=>e.id.endsWith(day));
      expect(group).toHaveLength(4);
      expect(group.every(e=>e.reference_period===period)).toBe(true);
    }
    expect(rows().find(e=>e.id==="bls:us_ppi:2026-11-13")).toMatchObject({reference_period:"2026-10",starts_at:"2026-11-13T13:30:00.000Z",importance:2,title:"Producer Price Index"});
    expect(rows().find(e=>e.id==="bls:us_ppi:2027-07-15")?.starts_at).toBe("2027-07-15T12:30:00.000Z");
    for (const code of Object.keys(PPI_METRICS)) expect(rows().some(e=>e.code===code)).toBe(true);
  });
  it("does not extrapolate new months and rejects duplicate reference periods", () => {
    expect(rows().some(e=>e.starts_at.startsWith("2028"))).toBe(false);
    const duplicate = scheduleHtml.replace("</table>","<tr><td>October 2026</td><td>Nov. 14, 2026</td><td>08:30 AM</td></tr></table>");
    expect(()=>ppiSchedule(duplicate)).toThrow("duplicate/ambiguous");
    expect(()=>ppiSchedule("<html>Access Denied</html>")).toThrow("title missing");
  });
  it("repeated daily schedules preserve legacy IDs/history and never duplicate PPI", async () => {
    const original = listedEvents().find(e=>e.id==="bls:us_ppi:2026-11-13")!;
    const memory = memoryFeedsDb({events:[{...original,identity_key:null,reference_period:null}]});
    const net = network({[PPI_SCHEDULE_URL]:scheduleHtml});
    await collectFeeds({scope:"schedules",now,db:memory.db,fetch:net.fetch});
    await collectFeeds({scope:"schedules",now:now+60_000,db:memory.db,fetch:net.fetch});
    expect(net.asked.filter(u=>u===PPI_SCHEDULE_URL)).toHaveLength(1);
    expect([...memory.events.values()].filter(e=>isPpiCode(e.code))).toHaveLength(56);
    expect(memory.events.get(original.id)?.reference_period).toBe("2026-10");
  });
  it("403 retains existing rows, logs diagnostics, caps retries and does not stop other schedules", async () => {
    const memory = memoryFeedsDb({events:rows()});
    const net = network({[PPI_SCHEDULE_URL]:"Access Denied"},403);
    await collectFeeds({scope:"schedules",now,db:memory.db,fetch:net.fetch});
    await collectFeeds({scope:"schedules",now:now+60_000,db:memory.db,fetch:net.fetch});
    expect(net.asked.filter(u=>u===PPI_SCHEDULE_URL)).toHaveLength(1);
    expect([...memory.events.values()].filter(e=>isPpiCode(e.code))).toHaveLength(56);
    expect(memory.runs.find(r=>r.source==="bls-ppi-schedule")).toMatchObject({ok:false,error:`HTTP 403 ${PPI_SCHEDULE_URL}`});
    expect(memory.runs.some(r=>r.source==="bea-schedule")).toBe(true);
  });
  it("learns later real official months from the network after an earlier limited stored horizon", async () => {
    const memory = memoryFeedsDb({events:rows().slice(0,4),lastRuns:{"bls-ppi-schedule":now-86_400_000}});
    const net = network({[PPI_SCHEDULE_URL]:scheduleHtml});
    await collectFeeds({scope:"schedules",now,db:memory.db,fetch:net.fetch});
    expect([...memory.events.values()].filter(e=>isPpiCode(e.code))).toHaveLength(56);
    expect(memory.events.get("bls:us_core_ppi_yoy:2027-12-15")?.reference_period).toBe("2027-11");
    expect(net.asked.filter(u=>u===PPI_SCHEDULE_URL)).toHaveLength(1);
  });
  it("reports exhaustion of the published horizon without generating next-year events", async () => {
    const memory = memoryFeedsDb({events:rows()});
    const net = network({[PPI_SCHEDULE_URL]:scheduleHtml});
    await collectFeeds({scope:"schedules",now:Date.parse("2028-01-01T12:00Z"),db:memory.db,fetch:net.fetch});
    expect(memory.runs.find(r=>r.source==="bls-ppi-schedule")).toMatchObject({ok:false,error:"BLS PPI schedule: official future horizon exhausted; existing events retained"});
    expect([...memory.events.values()].filter(e=>isPpiCode(e.code))).toHaveLength(56);
    expect([...memory.events.values()].some(e=>isPpiCode(e.code)&&e.starts_at.startsWith("2028"))).toBe(false);
  });
  it("an explicitly versioned move keeps identity/ID; unversioned conflicting dates do not overwrite it", async () => {
    const memory = memoryFeedsDb({events:rows()});
    const original = rows()[0];
    const versioned = (date:string,version:string) => ppiSchedule(scheduleHtml.replace("Nov. 13, 2026",date)+`<p>Last Modified Date: ${version}</p>`);
    await memory.db.upsertEvents(versioned("Nov. 13, 2026","November 6, 2026"));
    await memory.db.upsertEvents(versioned("Nov. 16, 2026","November 7, 2026"));
    expect(memory.events.get(original.id)?.starts_at).toBe("2026-11-16T13:30:00.000Z");
    await expect(memory.db.upsertEvents(rows())).rejects.toThrow("freshness");
    expect(memory.events.get(original.id)?.identity_key).toBe(original.identity_key);
  });
});
