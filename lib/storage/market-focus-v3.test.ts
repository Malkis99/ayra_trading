import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { FocusStorage, focusStorage } from "./market-focus";
import { FocusStorage as LegacyStorage } from "../../test-fixtures/market-focus-v2/storage";
import { FOCUS_CHECKS, customFocusId, emptyFocus, focusFieldRevision, parseFocus, systemFocusValue, templateId, type FocusEntry, type FocusField } from "@/lib/market/market-focus";
import { alertsOf, dueAlerts } from "@/lib/market/focus-notifications";
import { catalogFromPreference, type CatalogItem, type CustomSession } from "@/lib/market/focus-catalog";
import { AppStorage } from "./index";
import { exportGuestData, deleteGuestData } from "./profile-transfer";

const A="account:00000000-0000-4000-8000-000000002701",B="account:00000000-0000-4000-8000-000000002702";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const setup=()=>{const name=`focus-v3-${crypto.randomUUID()}`;return {name,a:new FocusStorage(name),b:new FocusStorage(name)}};
async function put(name:string,store:string,value:unknown){const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();}
async function create(storage:FocusStorage,space=A,kind:FocusField="poi",n=1,session?:CustomSession){return (await storage.changeCatalog(space,"eurusd",{create:uuid(n),kind,label:`Type ${n}`,...(session?{session}:{})},0)).catalog.items.find(i=>i.id===uuid(n))!;}
async function choose(storage:FocusStorage,item:CatalogItem,id:"eurusd"|"gold"="eurusd",space=A){const row=await storage.read(space,id);return storage.patch(space,id,{custom:item.kind,id:item.id,catalogRevision:item.revision,entryRevision:row.revision,fieldRevision:focusFieldRevision(row,item.kind)},0);}
afterEach(()=>{vi.restoreAllMocks();AppStorage.setUserId(null);});

it("reads and standard edits stay V2; only explicit custom selection atomically upgrades one row and preserves metadata",async()=>{
  const {name,a}=setup();await a.read(A,"eurusd");const row={...emptyFocus(A,"eurusd"),revision:7,direction:"bullish" as const,opaque:{keep:true}};row.checklist.items[1].checked=true;
  const alerts={...alertsOf(row),completion:true,seenCompletion:4,seenSession:123,seenReminder:456};await put(name,"entries",{...row,localAlerts:alerts});
  const item=await create(a);expect((await a.read(A,"eurusd")).version).toBe(2);const upgraded=await choose(a,item);
  expect(upgraded).toMatchObject({version:3,spaceId:A,instrumentId:"eurusd",revision:8,opaque:{keep:true},localAlerts:alerts});expect(upgraded.checklist).toEqual(row.checklist);expect(systemFocusValue(upgraded,"direction")).toBe("bullish");expect(customFocusId(upgraded,"poi")).toBe(item.id);expect(dueAlerts(upgraded,Date.now())).toEqual([]);
  expect((await a.read(A,"gold")).version).toBe(2);expect((await a.exportSpace(A)).databaseVersion).toBe(2);
});
it("one library is shared by instruments but isolated from account B and Guest; rename never changes IDs or entries",async()=>{
  const {a}=setup(),item=await create(a);await choose(a,item);await choose(a,item,"gold");const before=(await a.exportSpace(A)).entries;
  await a.changeCatalog(A,"eurusd",{update:item.id,itemRevision:1,label:"Renamed"},0);
  expect((await a.catalog(A)).references[item.id]).toEqual(["eurusd","gold"]);expect((await a.exportSpace(A)).entries).toEqual(before);expect((await a.catalog(B)).catalog.items).toEqual([]);expect((await a.catalog("guest")).catalog.items).toEqual([]);
});
it("CAS merges different item edits and rejects stale same-item updates or kind/deleted/revision mismatches",async()=>{
  const {a,b}=setup(),one=await create(a),two=await create(a,A,"mss",2);
  await Promise.all([a.changeCatalog(A,"eurusd",{update:one.id,itemRevision:1,label:"One"},0),b.changeCatalog(A,"gold",{update:two.id,itemRevision:1,label:"Two"},0)]);
  await expect(a.changeCatalog(A,"eurusd",{update:one.id,itemRevision:1,label:"Stale"},0)).rejects.toMatchObject({kind:"conflict"});
  await expect(choose(a,one)).rejects.toMatchObject({kind:"conflict"});
  const row=await a.read(A,"eurusd");await expect(a.patch(A,"eurusd",{custom:"session",id:two.id,catalogRevision:2,entryRevision:row.revision,fieldRevision:0},0)).rejects.toMatchObject({kind:"conflict"});
  await expect(a.changeCatalog(A,"eurusd",{remove:"fvg",itemRevision:1,references:[]},0)).rejects.toMatchObject({kind:"conflict"});
});
it("first conversion rejects an old V2 revision and V3 field CAS does not overwrite another selection",async()=>{
  const {a}=setup(),item=await create(a);const baseline=await a.read(A,"eurusd");await a.patch(A,"eurusd",{field:"direction",value:"bearish"});
  await expect(a.patch(A,"eurusd",{custom:"poi",id:item.id,catalogRevision:1,entryRevision:baseline.revision,fieldRevision:0},0)).rejects.toMatchObject({kind:"conflict"});
  const row=await choose(a,item);await a.patch(A,"eurusd",{field:"poi",value:null,fieldRevision:focusFieldRevision(row,"poi")});
  await expect(a.patch(A,"eurusd",{custom:"poi",id:item.id,catalogRevision:1,entryRevision:row.revision,fieldRevision:focusFieldRevision(row,"poi")},0)).rejects.toMatchObject({kind:"conflict"});
  expect((await a.read(A,"eurusd")).version).toBe(3);
});
it("delete checks references again, uses a tombstone, keeps used selections visible and blocks new selections",async()=>{
  const {a,b}=setup(),item=await create(a);await choose(a,item);const refs=(await a.catalog(A)).references[item.id];await choose(b,item,"gold");
  await expect(a.changeCatalog(A,"eurusd",{remove:item.id,itemRevision:1,references:refs},0)).rejects.toMatchObject({kind:"conflict"});
  await a.changeCatalog(A,"eurusd",{remove:item.id,itemRevision:1,references:["eurusd","gold"]},0);
  expect((await a.catalog(A)).catalog.items[0]).toMatchObject({id:item.id,label:item.label,deleted:true,revision:2});expect(customFocusId(await a.read(A,"eurusd"),"poi")).toBe(item.id);
  await expect(choose(b,{...item,revision:2},"gold")).rejects.toMatchObject({kind:"conflict"});
});
it("reset keeps the library, custom checklist and notification receipts, without downgrading or new events",async()=>{
  const {a}=setup(),item=await create(a);await a.configureAlerts(A,"eurusd",0,{completion:true,session:true,lead:5,reminder:null},0);await a.patch(A,"eurusd",{check:templateId(FOCUS_CHECKS[0]),value:true});const row=await choose(a,item),alerts=row.localAlerts;
  const result=await a.reset(A,"eurusd",row.revision,0);expect(result.kind).toBe("saved");expect(result.entry.version).toBe(3);expect(customFocusId(result.entry,"poi")).toBeNull();expect(result.entry.checklist.items.every(i=>!i.checked)).toBe(true);expect(result.entry.localAlerts).toEqual(alerts);expect((await a.catalog(A)).catalog.items).toHaveLength(1);expect(dueAlerts(result.entry,Date.now())).toEqual([]);
});
it("quota failure rolls back conversion; catalog abort and revoked account generation never confirm changes",async()=>{
  const {a}=setup(),item=await create(a),before=await a.exportSpace(A);
  const putFailure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(()=>{throw new DOMException("Quota","QuotaExceededError");});await expect(choose(a,item)).rejects.toThrow();putFailure.mockRestore();expect(await a.exportSpace(A)).toEqual(before);
  await expect(a.changeCatalog(A,"eurusd",{update:item.id,itemRevision:1,label:"Late"},0,()=>false)).rejects.toMatchObject({kind:"cleared"});expect(await a.exportSpace(A)).toEqual(before);
  const catalogFailure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(()=>{throw new DOMException("Quota","QuotaExceededError");});await expect(a.changeCatalog(A,"eurusd",{update:item.id,itemRevision:1,label:"No"},0)).rejects.toThrow();catalogFailure.mockRestore();expect(await a.exportSpace(A)).toEqual(before);
});
it("old deployed tabs cannot write a real V3 row but retain raw export, ordinary V2 edits, preferences and cleanup",async()=>{
  const {name,a}=setup(),item=await create(a);await choose(a,item);const before=await a.read(A,"eurusd"),legacy=new LegacyStorage(name);
  await expect(legacy.read(A,"eurusd")).rejects.toMatchObject({kind:"unsupported"});await expect(legacy.patch(A,"eurusd",{field:"poi",value:"fvg"})).rejects.toMatchObject({kind:"unsupported"});await legacy.select(A,"gold");expect(await a.read(A,"eurusd")).toEqual(before);
  expect((await legacy.exportSpace(A)).entries).toEqual([before]);expect((await a.catalog(A)).catalog.items[0].id).toBe(item.id);await legacy.patch(A,"gold",{field:"poi",value:"fvg"});expect((await a.read(A,"gold")).version).toBe(2);
  await create(a,B,"poi",2);await legacy.clearSpace(A);expect((await a.exportSpace(A)).preferences).toBeNull();expect((await a.catalog(B)).catalog.items).toHaveLength(1);
});
it("preserves unknown fields, rejects newer catalogs without changing them, and leaves unrelated V2 editing available",async()=>{
  const {name,a}=setup(),item=await create(a),snapshot=await a.exportSpace(A),pref=snapshot.preferences as Record<string,unknown>;
  const catalog=catalogFromPreference(pref,A);await put(name,"preferences",{...pref,opaque:"keep",customCatalog:{...catalog,extra:true,items:[{...item,future:{keep:true}}]}});
  await a.changeCatalog(A,"gold",{update:item.id,itemRevision:1,label:"New name"},0);expect((await a.catalog(A)).catalog).toMatchObject({extra:true,items:[{future:{keep:true}}]});
  const preserved=await a.exportSpace(A);await put(name,"preferences",{...(preserved.preferences as object),customCatalog:{version:3,items:[],unknown:true}});await expect(create(a,A,"poi",5)).rejects.toMatchObject({kind:"unsupported"});await a.patch(A,"gold",{field:"direction",value:"neutral"});expect((await a.exportSpace(A)).preferences).toMatchObject({customCatalog:{version:3,unknown:true}});
});
it("enforces 30 active items per kind atomically and counts 160 Unicode code points, not UTF-16 units",async()=>{
  const {a,b}=setup();const results=await Promise.allSettled(Array.from({length:31},(_,i)=>create(i%2?a:b,A,"poi",i+1)));expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(30);expect((await a.catalog(A)).catalog.items).toHaveLength(30);
  const item=await create(a,A,"mss",100);await a.changeCatalog(A,"eurusd",{update:item.id,itemRevision:1,label:"😀".repeat(160)},0);await expect(a.changeCatalog(A,"eurusd",{update:item.id,itemRevision:2,label:"😀".repeat(161)},0)).rejects.toMatchObject({kind:"text"});
});
it("custom session civil times and overnight zone persist, but no custom session reminders are produced",async()=>{
  const {name,a}=setup();await a.read(A,"eurusd");const row={...emptyFocus(A,"eurusd"),revision:1,session:"london" as const};await put(name,"entries",{...row,localAlerts:{...alertsOf(row),session:true,enabledAt:Date.parse("2026-01-01T00:00Z")}});
  const poi=await create(a),withPoi=await choose(a,poi);expect(dueAlerts(withPoi,Date.parse("2026-03-30T06:55Z"))[0]?.kind).toBe("session");
  const session=await create(a,A,"session",2,{start:"23:00",end:"02:00",zone:"Europe/London"}),custom=await choose(a,session);
  expect((await a.catalog(A)).catalog.items.find(i=>i.id===session.id)?.session).toEqual({start:"23:00",end:"02:00",zone:"Europe/London"});expect(dueAlerts(custom,Date.parse("2026-03-30T06:55Z"))).toEqual([]);
  const restored=await a.patch(A,"eurusd",{field:"session",value:"london",fieldRevision:focusFieldRevision(custom,"session")});expect(dueAlerts(restored,Date.parse("2026-03-30T06:55Z"))[0]?.kind).toBe("session");
  for(const data of [{start:"01:00",end:"01:00",zone:"UTC"},{start:"25:00",end:"02:00",zone:"UTC"},{start:"01:00",end:"02:00",zone:"+04:00"},{start:"01:00",end:"02:00",zone:"No/Zone"}])await expect(create(a,A,"session",10,data)).rejects.toMatchObject({kind:"invalid"});
});
it("actual profile Guest export and cleanup include catalogs and V3 without copying another account",async()=>{
  const n=200+Math.floor(Math.random()*100000),item=await create(focusStorage,"guest","poi",n);await choose(focusStorage,item,"eurusd","guest");await create(focusStorage,B,"poi",n+1);
  const exported=await exportGuestData();expect(JSON.stringify(exported.marketFocus)).toContain(item.id);expect(JSON.stringify(exported.marketFocus)).not.toContain(uuid(n+1));
  AppStorage.setUserId(B.slice(8));await deleteGuestData();expect((await focusStorage.exportSpace("guest")).entries).toEqual([]);expect((await focusStorage.catalog(B)).catalog.items).toHaveLength(1);
});
it("an old purge ticket and unknown future rows cannot be used to delete or recreate custom data",async()=>{
  const {name,a}=setup(),item=await create(a);await a.read(A,"eurusd");await put(name,"entries",{...emptyFocus(A,"gold"),version:4,revision:1});await expect(a.changeCatalog(A,"eurusd",{remove:item.id,itemRevision:1,references:[]},0)).rejects.toMatchObject({kind:"unsupported"});
  await a.clearSpace(A);await expect(create(a)).rejects.toMatchObject({kind:"cleared"});expect((await a.catalog(A)).catalog.items).toEqual([]);
});
