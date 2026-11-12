import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { joltsSchedule } from "./bls-schedule";
import { JOLTS_CODE, JOLTS_SCHEDULE_URL, joltsReleaseUrl, parseJoltsRelease, joltsResults, verifiedJoltsMeta } from "./jolts";
import { listedEvents } from "./schedules";
import { memoryFeedsDb } from "./memory-db";
import { collectFeeds, type Fetcher } from "./collect";
import { blsRequestBody, blsResults, BLS_SERIES, BLS_API_V1 } from "./bls";
const html=readFileSync("lib/market/feeds/fixtures/jolts-2026-11-03.html","utf8");
const schedule=readFileSync("lib/market/feeds/fixtures/jolts-schedule-2026-11-06.html","utf8");
const now=Date.parse("2026-11-06T12:00Z");
const september=()=>listedEvents().find(e=>e.id==="bls:us_jolts:2026-11-03")!;
function network(pages:Record<string,string>,status=200) {
 const asked:string[]=[];
 const fetch:Fetcher=async(url)=>{asked.push(url);return {ok:status===200 && pages[url]!==undefined,status:pages[url]===undefined?404:status,text:async()=>pages[url]||""};};
 return {fetch,asked};
}
describe("JOLTS dated initial facts",()=>{
 it("keeps the initial August actual distinct from revised August previous in the September release",()=>{
  const august=parseJoltsRelease(readFileSync("lib/market/feeds/fixtures/jolts-2026-09-29.html","utf8"),"2026-09-29");
  expect(august).toMatchObject({period:"2026-08",actual:"7.079M",previous:"7.335M",published:"2026-09-29T14:00:00.000Z"});
  const release=parseJoltsRelease(html,"2026-11-03");
  expect(release).toMatchObject({period:"2026-09",actual:"7.523M",previous:"7.190M",published:"2026-11-03T15:00:00.000Z"});
  const [result]=joltsResults([september()],release);
  expect(result.result_meta).toMatchObject({series:BLS_SERIES.jolts,unit:"million",adjustment:"SA",vintage:"release",estimate_status:"preliminary",previous_source:{period:"2026-08",basis:"reported-in-release"}});
  expect(verifiedJoltsMeta("2026-09",result.result_meta)).toBe(true);
  expect(joltsResults([{...september(),reference_period:"2026-08"}],release)).toEqual([]);
 });
 it("rejects rates, wrong series/table/period/date, non-preliminary and corrected releases",()=>{
  for(const bad of [html.replaceAll("Levels (in thousands)","Rates"),html.replace("seasonally adjusted","not seasonally adjusted"),html.replace("Sept. 2026<sup>(p)</sup>","Oct. 2026<sup>(p)</sup>"),html.replaceAll("<sup>(p)</sup>",""),html+"<p>corrected release</p>",html.replace("<th>Total</th>","<th>Total private</th>")]) expect(()=>parseJoltsRelease(bad,"2026-11-03")).toThrow();
  expect(()=>parseJoltsRelease(html,"2026-11-04")).toThrow("date/reference");
  expect(()=>joltsReleaseUrl("2026-02-30")).toThrow();
 });
 it("missing actual/previous never become zero or another month's value",()=>{
  expect(parseJoltsRelease(html.replace("7,190","-"),"2026-11-03").previous).toBeNull();
  expect(joltsResults([september()],parseJoltsRelease(html.replace("7,523","-"),"2026-11-03"))).toEqual([]);
  expect(verifiedJoltsMeta("2026-09",{period:"2026-09",series:"us_jolts",unit:"million",adjustment:"SA"})).toBe(false);
 });
 it("does not use JOLTS API for initial facts or even request its series",()=>{
  expect(JSON.parse(blsRequestBody(undefined,2026)).seriesid).toEqual([BLS_SERIES.payrolls,BLS_SERIES.unemployment]);
  expect(blsResults([september().id],new Map([[BLS_SERIES.jolts,[{period:"2026-09",value:9999}]]]),[september()])).toEqual([]);
 });
 it("saves all release provenance and only uses verified initial DB previous when absent",async()=>{
  const memory=memoryFeedsDb({events:[september()]});
  const prior=listedEvents().find(e=>e.code===JOLTS_CODE)!;
  const priorId="bls:us_jolts:2026-09-29";
  memory.events.set(priorId,{...prior,id:priorId,status:"released",actual:"7.079M",starts_at:"2026-09-29T14:00Z",reference_period:"2026-08",result_meta:joltsResults([{...prior,id:priorId,reference_period:"2026-08"}],parseJoltsRelease(readFileSync("lib/market/feeds/fixtures/jolts-2026-09-29.html","utf8"),"2026-09-29"))[0].result_meta});
  const net=network({[joltsReleaseUrl("2026-11-03")]:html.replace("7,190","-")});
  await collectFeeds({scope:"releases",now:Date.parse("2026-11-03T15:15Z"),db:memory.db,fetch:net.fetch});
  expect(memory.events.get(september().id)).toMatchObject({actual:"7.523M",previous:"7.079M",result_meta:{previous_source:{basis:"initial-prior-release"}}});
  expect(net.asked.filter(u=>u.includes("bls.gov"))).toEqual([joltsReleaseUrl("2026-11-03")]);
 });
 it("unverified legacy previous is not promoted to initial or used as fallback",async()=>{
  const memory=memoryFeedsDb({events:[september()]});
  memory.events.set("legacy",{...september(),id:"legacy",status:"released",actual:"9.99M",reference_period:"2026-08",starts_at:"2026-09-29T14:00Z"});
  await collectFeeds({scope:"releases",now:Date.parse("2026-11-03T15:15Z"),db:memory.db,fetch:network({[joltsReleaseUrl("2026-11-03")]:html.replace("7,190","-")}).fetch});
  expect(memory.events.get(september().id)).toMatchObject({actual:"7.523M"});
  expect(memory.events.get(september().id)?.previous).toBeUndefined();
 });
 it("isolates a blocked JOLTS slot and keeps the existing NFP batch and legacy fact intact", async () => {
  const due = september();
  const nfp = {...due, id: "bls:us_nfp:2026-11-03", code: "us_nfp", identity_key: null};
  const memory = memoryFeedsDb({events: [due, nfp]});
  const old = {...due, id: "bls:us_jolts:2026-09-29", starts_at: "2026-09-29T14:00Z", reference_period: "2026-08", status: "released" as const, actual: "7.08M"};
  memory.events.set(old.id, old);
  const asked: string[] = [];
  const fetch: Fetcher = async (url) => {
   if (url.includes("bls.gov")) asked.push(url);
   return {ok: url === BLS_API_V1, status: url === BLS_API_V1 ? 200 : 403, text: async () => JSON.stringify({Results: {series: [
    {seriesID: BLS_SERIES.payrolls, data: [{year:"2026", period:"M09", value:"159044"}, {year:"2026", period:"M08", value:"159015"}]},
    {seriesID: BLS_SERIES.unemployment, data: [{year:"2026", period:"M09", value:"4.2"}]},
   ]}})};
  };
  const at = Date.parse("2026-11-03T15:15Z");
  for (const offset of [0, 11, 12]) await collectFeeds({scope:"releases", now:at + offset * 60_000, db:memory.db, fetch});
  expect(asked).toEqual([BLS_API_V1, joltsReleaseUrl("2026-11-03")]);
  expect(memory.events.get(nfp.id)?.actual).toBe("+29K · 4.2%");
  expect(memory.events.get(old.id)).toEqual(old);
  await collectFeeds({scope:"schedules", now, db:memory.db, fetch:network({}).fetch});
  expect(memory.runs.find(r => r.source === "bls-jolts-history")?.error).toContain(old.id);
 });
});
describe("JOLTS automatic official schedule",()=>{
 it("learns the new published October month, preserves old IDs and deduplicates repeated daily runs",async()=>{
  const memory=memoryFeedsDb({events:[september()]});
  const net=network({[JOLTS_SCHEDULE_URL]:schedule});
  await collectFeeds({scope:"schedules",now,db:memory.db,fetch:net.fetch});
  await collectFeeds({scope:"schedules",now:now+60_000,db:memory.db,fetch:net.fetch});
  expect([...memory.events.values()].filter(e=>e.code===JOLTS_CODE).map(e=>e.id).sort()).toEqual([september().id,"bls:us_jolts:2026-12-01"].sort());
  expect(memory.events.get("bls:us_jolts:2026-12-01")).toMatchObject({reference_period:"2026-10",starts_at:"2026-12-01T15:00:00.000Z",importance:2});
  expect(net.asked.filter(u=>u===JOLTS_SCHEDULE_URL)).toHaveLength(1);
  expect(joltsSchedule(schedule)).toHaveLength(1);
 });
 it("versioned moves preserve identity; unproven moves conflict; source disappearance is not cancellation",async()=>{
  // Synthetic changes model explicit upstream versions, not claimed future BLS dates.
  const withVersion=(text:string,date:string)=>text+`<p>Last Modified Date: ${date}</p>`;
  const memory=memoryFeedsDb({events:joltsSchedule(withVersion(schedule,"November 6, 2026"))});
  const moved=joltsSchedule(withVersion(schedule.replace("Dec. 01","Dec. 02"),"November 7, 2026"));
  await memory.db.upsertEvents(moved);
  const id="bls:us_jolts:2026-12-01";
  expect(memory.events.get(id)?.starts_at).toBe("2026-12-02T15:00:00.000Z");
  await expect(memory.db.upsertEvents(joltsSchedule(schedule))).rejects.toThrow("freshness");
  await memory.db.upsertEvents([]);
  expect(memory.events.get(id)?.status).toBe("scheduled");
  const identity=memory.events.get(id)?.identity_key;
  await memory.db.upsertEvents([{...moved[0],schedule_meta:{modified:"2026-11-08T00:00Z",cancelled:true}}]);
  await memory.db.upsertEvents([{...moved[0],schedule_meta:{modified:"2026-11-09T00:00Z",cancelled:false}}]);
  expect(memory.events.get(id)).toMatchObject({status:"scheduled",identity_key:identity});
 });
 it.each([403,429])("HTTP %s retains history, never falls back to API and isolates failure",async status=>{
  const memory=memoryFeedsDb({events:[september()]});
  const net=network({[JOLTS_SCHEDULE_URL]:"Access Denied",[joltsReleaseUrl("2026-11-03")]:"Access Denied"},status);
  await collectFeeds({scope:"schedules",now,db:memory.db,fetch:net.fetch});
  await collectFeeds({scope:"schedules",now:now+60_000,db:memory.db,fetch:net.fetch});
  expect(net.asked.filter(u=>u===JOLTS_SCHEDULE_URL)).toHaveLength(1);
  const before=net.asked.length;
  const result=await collectFeeds({scope:"releases",now:Date.parse("2026-11-03T15:15Z"),db:memory.db,fetch:net.fetch});
  expect(result.results.find(r=>r.source==="bls-jolts-release")).toMatchObject({ok:false});
  expect(net.asked.slice(before)).not.toContain(BLS_API_V1);
  expect(memory.events.get(september().id)?.status).toBe("scheduled");
  expect(memory.runs.some(r=>r.source==="bea-schedule")).toBe(true);
 });
 it("times out and aborts a stalled body without blocking other sources",async()=>{
  vi.useFakeTimers();
  try {
   const memory=memoryFeedsDb({events:[september()]});let signal:AbortSignal|undefined;
   const fetch:Fetcher=async(url,init)=>url===joltsReleaseUrl("2026-11-03") ? (signal=init?.signal,{ok:true,status:200,text:()=>new Promise<string>(()=>{})}) : {ok:false,status:404,text:async()=>""};
   const pending=collectFeeds({scope:"releases",now:Date.parse("2026-11-03T15:15Z"),db:memory.db,fetch});
   await vi.advanceTimersByTimeAsync(15001);
   expect((await pending).results.find(r=>r.source==="bls-jolts-release")).toMatchObject({error:"timeout"});
   expect(signal?.aborted).toBe(true);
  } finally {vi.useRealTimers();}
 });
 it("does not extrapolate an exhausted horizon or accept duplicate periods",async()=>{
  expect(()=>joltsSchedule(schedule.replace("</table>","<tr><td>October 2026</td><td>Dec. 02, 2026</td><td>10:00 AM</td></tr></table>"))).toThrow("duplicate/ambiguous");
  const memory=memoryFeedsDb();
  await collectFeeds({scope:"schedules",now:Date.parse("2027-01-01T12:00Z"),db:memory.db,fetch:network({[JOLTS_SCHEDULE_URL]:schedule}).fetch});
  expect(memory.runs.find(r=>r.source==="bls-jolts-schedule")).toMatchObject({ok:false,error:"BLS JOLTS schedule: official future horizon exhausted; existing events retained"});
  expect([...memory.events.values()].some(e=>e.code===JOLTS_CODE && e.starts_at.startsWith("2027"))).toBe(false);
 });
});
