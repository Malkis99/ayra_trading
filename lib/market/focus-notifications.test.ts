import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { FocusStorage } from "@/lib/storage/market-focus";
import { FOCUS_CHECKS, templateId } from "./market-focus";
import { alertsOf, dueAlerts, ALERT_GRACE } from "./focus-notifications";
import { defaultSessionHours } from "./sessions";
import { defaultSettings } from "@/lib/notifications/types";
import { inQuietHours, shouldStore } from "@/lib/notifications/preferences";
let count = 0;
const setup = () => { const name = `focus-alerts-${++count}`; return [new FocusStorage(name), new FocusStorage(name)] as const; };
const values = { completion: true, session: false, lead: 5, reminder: null };
afterEach(() => { vi.restoreAllMocks(); });
it("defaults off, completion is recorded only for the committed last manual check; two tabs claim once", async () => {
  const [a,b] = setup(); expect(alertsOf(await a.read("guest","eurusd")).completion).toBe(false);
  await a.configureAlerts("guest","eurusd",0,values,0);
  for (const key of FOCUS_CHECKS.slice(0,-1)) await a.patch("guest","eurusd",{check:templateId(key),value:true});
  expect(dueAlerts(await a.read("guest","eurusd"),Date.now())).toEqual([]);
  await Promise.all([a.patch("guest","eurusd",{check:templateId("reaction"),value:true}),b.patch("guest","eurusd",{check:templateId("reaction"),value:true})]);
  const event=dueAlerts(await a.read("guest","eurusd"),Date.now())[0];expect(event.kind).toBe("completion");
  expect((await Promise.all([a.claimAlert("guest","eurusd",event,0),b.claimAlert("guest","eurusd",event,0)])).sort()).toEqual([false,true]);
  expect(dueAlerts(await a.read("guest","eurusd"),Date.now())).toEqual([]);
  await a.patch("guest","eurusd",{check:templateId("reaction"),value:false});await a.patch("guest","eurusd",{check:templateId("reaction"),value:true});
  expect(dueAlerts(await a.read("guest","eurusd"),Date.now())).toHaveLength(1);
});
it("load, rename, move, delete and reset never generate completion; an aborted last-check transaction creates no event",async()=>{
  const [a]=setup();await a.configureAlerts("guest","eurusd",0,values,0);
  for(const key of FOCUS_CHECKS.slice(0,-1))await a.patch("guest","eurusd",{check:templateId(key),value:true});
  let row=await a.read("guest","eurusd");
  await a.patch("guest","eurusd",{rename:templateId("reaction"),text:"Review",itemRevision:1});
  await a.patch("guest","eurusd",{move:templateId("reaction"),step:-1,orderRevision:row.checklist.orderRevision});
  const put=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(()=>{throw new DOMException("quota","QuotaExceededError");});
  await expect(a.patch("guest","eurusd",{check:templateId("reaction"),value:true})).rejects.toThrow();put.mockRestore();
  row=await a.read("guest","eurusd");expect(dueAlerts(row,Date.now())).toEqual([]);expect(row.checklist.items.find(i=>i.id===templateId("reaction"))!.checked).toBe(false);
  await a.patch("guest","eurusd",{remove:templateId("reaction"),itemRevision:2});row=await a.read("guest","eurusd");expect(dueAlerts(row,Date.now())).toEqual([]);
  await a.reset("guest","eurusd",row.revision);expect(dueAlerts(await a.read("guest","eurusd"),Date.now())).toEqual([]);
});
it("CAS config, cancel, expiry and purge reject stale candidates without touching another account",async()=>{
  const [a,b]=setup(),A="account:00000000-0000-4000-8000-000000000001";
  const at=Date.now()+10000;
  await a.configureAlerts("guest","eurusd",0,{...values,reminder:at},0);
  await expect(b.configureAlerts("guest","eurusd",0,values,0)).rejects.toMatchObject({kind:"conflict"});
  const entry=await a.read("guest","eurusd"),event=dueAlerts(entry,at)[0];
  expect(dueAlerts(entry,at+ALERT_GRACE)).toEqual([]);
  await a.configureAlerts("guest","eurusd",1,values,0);
  expect(await b.claimAlert("guest","eurusd",event,0)).toBe(false);
  await a.configureAlerts(A,"eurusd",0,values,0);await a.clearSpace("guest");
  await expect(b.configureAlerts("guest","eurusd",0,values,0)).rejects.toMatchObject({kind:"cleared"});
  expect(alertsOf(await a.read(A,"eurusd")).completion).toBe(true);
});
it.each([
  ["2026-03-20T07:55:00Z","london"], ["2026-03-30T06:55:00Z","london"],
  ["2026-03-06T14:25:00Z","newYork"], ["2026-03-09T13:25:00Z","newYork"],
  ["2026-10-26T07:55:00Z","london"], ["2026-11-02T14:25:00Z","newYork"],
] as const)("uses AYRA session calendar and DST at %s",async(iso,session)=>{
  const [a]=setup();await a.patch("guest","eurusd",{field:"session",value:session});
  const entry=await a.read("guest","eurusd");entry.localAlerts={...alertsOf(entry),session:true,enabledAt:Date.parse("2026-01-01Z")};
  const events=dueAlerts(entry,Date.parse(iso));expect(events).toHaveLength(1);expect(events[0].kind).toBe("session");
  const hours=defaultSessionHours();hours[session==="london"?"london":"newyork"].start="10:00";
  expect(dueAlerts(entry,Date.parse(iso),hours)).toEqual([]);
});
it("respects master pause, quiet hours, instrument filter and disabled session type",()=>{
  const s=defaultSettings("Europe/London");expect(shouldStore("focus_completion",{...s,all_disabled:true},[])).toBe(false);
  expect(shouldStore("focus_reminder",{...s,instrument_ids:["gold"]},[],3,["eurusd"])).toBe(false);
  expect(shouldStore("session_open",s,[{type_code:"session_open",channel_code:"site",enabled:false}])).toBe(false);
  expect(inQuietHours({...s,quiet_enabled:true},new Date("2026-11-22T23:00Z"))).toBe(true);
});
