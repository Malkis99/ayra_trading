import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { FocusStorage } from "@/lib/storage/market-focus";
import { dueAlerts, ALERT_GRACE, alertsOf } from "./focus-notifications";
import { defaultSessionReminder } from "./custom-session-time";
import { sessionReminder, catalogFromPreference, type FocusCatalog, type CustomSession } from "./focus-catalog";
import { customReceipts } from "./custom-session-alerts";
import { focusFieldRevision } from "./market-focus";
import { catalogFromPreference as oldCatalog } from "../../test-fixtures/market-focus-2d/catalog";
import { IDBObjectStore } from "fake-indexeddb";
const ID="00000000-0000-4000-8000-000000002801";
const before=Date.parse("2026-03-30T06:00Z"),due=Date.parse("2026-03-30T06:55Z");
const session:CustomSession={start:"08:00",end:"17:00",zone:"Europe/London",reminders:{...defaultSessionReminder(),enabled:true}};
async function setup(value=session,space="guest"){
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(before);
  const name=`custom-reminders-${crypto.randomUUID()}`,a=new FocusStorage(name),b=new FocusStorage(name);
  await a.changeCatalog(space,"eurusd",{create:ID,kind:"session",label:"My session",session:value},0);
  await a.patch(space,"eurusd",{custom:"session",id:ID,catalogRevision:1,entryRevision:0,fieldRevision:0},0);
  return {a,b,space};
}
async function candidates(a:FocusStorage,now=due,space="guest"){return dueAlerts(await a.read(space,"eurusd"),now,undefined,(await a.catalog(space)).catalog);}
async function update(a:FocusStorage,extra:Partial<CustomSession>={},label="Renamed"){
  const item=(await a.catalog("guest")).catalog.items[0];
  await a.changeCatalog("guest","eurusd",{update:ID,itemRevision:item.revision,label,session:{...item.session!,...extra}},0);
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it("legacy sessions remain V1, weekdays default but reminders stay off; editing explicitly upgrades only the catalog",async()=>{
  const {a}=await setup({start:"08:00",end:"17:00",zone:"Europe/London"});
  const snapshot=await a.exportSpace("guest"),catalog=(await a.catalog("guest")).catalog;
  expect(catalog.version).toBe(1);expect(sessionReminder(catalog.items[0].session!)).toMatchObject({days:[1,2,3,4,5],enabled:false});expect(await candidates(a)).toEqual([]);
  expect(await a.exportSpace("guest")).toEqual(snapshot);
  const collision=structuredClone((snapshot.preferences as {customCatalog:FocusCatalog}).customCatalog);collision.items[0].session!.reminders={...defaultSessionReminder(),enabled:true};
  expect(()=>catalogFromPreference({...snapshot.preferences as object,customCatalog:collision},"guest")).toThrowError("market_focus_unsupported");
  await update(a,{},"Renamed legacy");expect((await a.catalog("guest")).catalog.version).toBe(1);expect((await a.catalog("guest")).catalog.items[0].session!.reminders).toBeUndefined();
  await update(a,{reminders:defaultSessionReminder()});expect((await a.catalog("guest")).catalog.version).toBe(2);expect((await a.exportSpace("guest")).databaseVersion).toBe(2);
});
it("two tabs atomically claim a civil cycle once; reload and rename preserve its receipt",async()=>{
  const {a,b}=await setup();vi.setSystemTime(due);const [event]=await candidates(a);
  expect(event.custom).toMatchObject({id:ID,cycle:"2026-03-30"});
  expect((await Promise.all([a.claimAlert("guest","eurusd",event,0),b.claimAlert("guest","eurusd",event,0)])).sort()).toEqual([false,true]);
  await update(a);expect(await candidates(b)).toEqual([]);expect(customReceipts(await b.read("guest","eurusd")).seen[ID]).toBe("2026-03-30");
  expect(alertsOf(await b.read("guest","eurusd")).seenSession).toBe(0);
});
it("a stale rename candidate is rejected; a fresh one keeps the same cycle without a second delivery",async()=>{
  const {a,b}=await setup();vi.setSystemTime(due);const [old]=await candidates(a);await update(a);
  expect(await b.claimAlert("guest","eurusd",old,0)).toBe(false);
  const [fresh]=await candidates(b);expect(fresh.custom?.cycle).toBe(old.custom?.cycle);expect(await a.claimAlert("guest","eurusd",fresh,0)).toBe(true);
  await update(a,{},"Again");expect(await candidates(a)).toEqual([]);
});
it("time, zone, lead, enabled and days edits never create an immediate event or replay a processed cycle",async()=>{
  const {a}=await setup();vi.setSystemTime(due);const [event]=await candidates(a);await a.claimAlert("guest","eurusd",event,0);
  await update(a,{start:"08:01",zone:"Europe/London"});vi.setSystemTime(due+60000);expect(await candidates(a,due+60000)).toEqual([]);
  const item=(await a.catalog("guest")).catalog.items[0];expect(item.session!.reminders!.armedAt).toBe(due);
  await update(a,{zone:"UTC",reminders:{...sessionReminder(item.session!),lead:0,days:[1],enabled:false}});
  await update(a,{reminders:{...sessionReminder((await a.catalog("guest")).catalog.items[0].session!),enabled:true}});
  expect(await candidates(a,Date.parse("2026-03-30T08:01Z"))).toEqual([]);
});
it("opting in at/after the deadline or selecting a session late does not generate a catch-up notification",async()=>{
  const {a}=await setup({...session,reminders:defaultSessionReminder()});vi.setSystemTime(due);
  await update(a,{reminders:{...defaultSessionReminder(),enabled:true}});expect(await candidates(a)).toEqual([]);
  vi.setSystemTime(before);await update(a); // rename alone preserves the existing arming barrier
  expect(await candidates(a)).toEqual([]);
  const {a:b}=await setup();vi.setSystemTime(due);const row=await b.read("guest","eurusd");
  await b.patch("guest","eurusd",{custom:"session",id:ID,catalogRevision:1,entryRevision:row.revision,fieldRevision:focusFieldRevision(row,"session")},0);
  expect(await candidates(b)).toEqual([]);
});
it("activity days, empty schedules, lead bounds and the grace boundary are respected",async()=>{
  const {a}=await setup();expect(await candidates(a,due-1)).toEqual([]);expect(await candidates(a,due+ALERT_GRACE)).toEqual([]);
  expect(await candidates(a,Date.parse("2026-04-04T06:55Z"))).toEqual([]);
  await update(a,{reminders:{...defaultSessionReminder(),enabled:true,days:[]}});expect(await candidates(a)).toEqual([]);
  for(const reminders of [{...defaultSessionReminder(),days:[1,1]},{...defaultSessionReminder(),days:[8]},{...defaultSessionReminder(),lead:10},{...defaultSessionReminder(),version:2}])await expect(update(a,{reminders:reminders as CustomSession["reminders"]})).rejects.toThrow();
});
it("lead time before midnight belongs to the weekday of the following session start",async()=>{
  const {a}=await setup({start:"00:05",end:"02:00",zone:"UTC",reminders:{...defaultSessionReminder(),enabled:true,lead:15,days:[2]}});
  const deadline=Date.parse("2026-03-30T23:50Z");vi.setSystemTime(deadline);const [event]=await candidates(a,deadline);expect(event.custom?.cycle).toBe("2026-03-31");expect(await a.claimAlert("guest","eurusd",event,0)).toBe(true);
});
it("delete, changed selection, purge and a stale catalog revision invalidate a pending claim",async()=>{
  const {a,b}=await setup();vi.setSystemTime(due);const [event]=await candidates(a);
  await a.changeCatalog("guest","eurusd",{remove:ID,itemRevision:1,references:["eurusd"]},0);
  expect(await b.claimAlert("guest","eurusd",event,0)).toBe(false);expect((await a.catalog("guest")).catalog.items[0].deleted).toBe(true);
  await a.clearSpace("guest");await expect(b.claimAlert("guest","eurusd",event,0)).rejects.toMatchObject({kind:"cleared"});
});
it("confirmed claim can be suppressed after a later edit without removing receipts; reset preserves receipts",async()=>{
  const {a}=await setup();vi.setSystemTime(due);const [event]=await candidates(a);await a.claimAlert("guest","eurusd",event,0);
  expect(await a.currentCustomAlert("guest","eurusd",event,0)).toBe(true);await update(a);expect(await a.currentCustomAlert("guest","eurusd",event,0)).toBe(false);
  const row=await a.read("guest","eurusd");await a.reset("guest","eurusd",row.revision,0);expect(customReceipts(await a.read("guest","eurusd"))).toEqual(customReceipts(row));
});
it("WATCH-2D reads untouched catalogs but gates a scheduled V2 catalog; raw export and selection retain its data",async()=>{
  const {a}=await setup({start:"08:00",end:"17:00",zone:"Europe/London"});
  expect(oldCatalog((await a.exportSpace("guest")).preferences,"guest").version).toBe(1);
  await update(a,{reminders:{...defaultSessionReminder(),enabled:true}});
  const before=await a.exportSpace("guest");expect(()=>oldCatalog(before.preferences,"guest")).toThrowError("market_focus_unsupported");
  await a.select("guest","gold");expect((await a.exportSpace("guest")).preferences).toMatchObject({customCatalog:(before.preferences as {customCatalog:unknown}).customCatalog});
});
it("aborted custom receipt writes never claim delivery; a later retry can commit exactly once",async()=>{
  const {a}=await setup();vi.setSystemTime(due);const [event]=await candidates(a);
  const put=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(()=>{throw new DOMException("Quota","QuotaExceededError");});
  await expect(a.claimAlert("guest","eurusd",event,0)).rejects.toThrow();put.mockRestore();expect(await candidates(a)).toHaveLength(1);
  expect(await a.claimAlert("guest","eurusd",event,0)).toBe(true);expect(await candidates(a)).toEqual([]);
});
it("receipt identity is independent by instrument and account, and permits a subsequent local day",async()=>{
  const {a}=await setup();await a.patch("guest","gold",{custom:"session",id:ID,catalogRevision:1,entryRevision:0,fieldRevision:0},0);vi.setSystemTime(due);
  const [first]=await candidates(a);await a.claimAlert("guest","eurusd",first,0);
  expect(await a.claimAlert("guest","gold",first,0)).toBe(false);
  const other=dueAlerts(await a.read("guest","gold"),due,undefined,(await a.catalog("guest")).catalog)[0];expect(await a.claimAlert("guest","gold",other,0)).toBe(true);
  const account="account:00000000-0000-4000-8000-000000002899";vi.setSystemTime(before);
  await a.changeCatalog(account,"eurusd",{create:ID,kind:"session",label:"Own session",session},0);await a.patch(account,"eurusd",{custom:"session",id:ID,catalogRevision:1,entryRevision:0,fieldRevision:0},0);vi.setSystemTime(due);
  expect(await a.claimAlert(account,"eurusd",first,0)).toBe(false);
  const own=(await candidates(a,due,account))[0];expect(await a.claimAlert(account,"eurusd",own,0)).toBe(true);
  vi.setSystemTime(due+86400000);const [next]=await candidates(a,due+86400000);expect(next.custom?.cycle).toBe("2026-03-31");expect(await a.claimAlert("guest","eurusd",next,0)).toBe(true);
});
it("unknown or invalid custom receipts fail closed without disabling an independent manual reminder",async()=>{
  const {a}=await setup();const entry=await a.read("guest","eurusd"),catalog=(await a.catalog("guest")).catalog,issue=vi.fn();
  for(const receipt of [{version:2,seen:{}},{version:1,seen:{[ID]:"2026-02-31"}}]){
    const value={...entry,customSessionReceipts:receipt,localAlerts:{...alertsOf(entry),reminder:due}};
    expect(dueAlerts(value,due,undefined,catalog,issue).map(alert=>alert.kind)).toEqual(["reminder"]);
  }expect(issue).toHaveBeenCalledTimes(2);
});
