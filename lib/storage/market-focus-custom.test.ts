import "fake-indexeddb/auto";
import { IDBCursorWithValue, IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { FocusStorage } from "./market-focus";
import { emptyFocus, focusChecked, FOCUS_CHECKS, FOCUS_ITEM_LIMIT, patchFocus, templateId } from "@/lib/market/market-focus";
import { AppStorage } from "./index";
import { deleteAccountDeviceData, deleteGuestData, exportGuestData } from "./profile-transfer";
import { focusStorage } from "./market-focus";

const A="account:00000000-0000-4000-8000-000000002251",B="account:00000000-0000-4000-8000-000000002252";
let n=0;
const setup=()=>{const name=`focus-custom-${++n}`;return{name,one:new FocusStorage(name),two:new FocusStorage(name)}};
const uuid=(number:number)=>`00000000-0000-4000-8000-${String(number).padStart(12,"0")}`;
const legacy=(spaceId:string,instrumentId="eurusd")=>({version:1,spaceId,instrumentId,revision:4,direction:"bullish",poi:"fvg",mss:"waiting",session:"london",opaque:{keep:true},checklist:{poiReached:true,liquiditySweep:false,displacement:true,mssCisd:false,retracementTest:true,reaction:false,extra:"preserve"}});
async function seedV1(name:string,rows:unknown[]){const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore("entries",{keyPath:["spaceId","instrumentId"]});r.result.createObjectStore("preferences",{keyPath:"spaceId"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction("entries","readwrite");for(const row of rows)tx.objectStore("entries").put(row);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();}
afterEach(()=>{vi.restoreAllMocks();AppStorage.setUserId(null);});
it("atomically migrates all six V1 marks across accounts and Guest, preserving opaque data",async()=>{
  const {name,one,two}=setup();await seedV1(name,[legacy(A),legacy(B),legacy("guest"),legacy(A,"futureinstrument")]);
  for(const space of [A,B,"guest"]){const row=await one.read(space,"eurusd");expect(row.version).toBe(2);expect(row.revision).toBe(5);expect(row.opaque).toEqual({keep:true});expect(row.checklist.extra).toBe("preserve");expect(row.checklist.items.map(i=>i.checked)).toEqual([true,false,true,false,true,false]);expect(row.checklist.items.map(i=>i.id)).toEqual(FOCUS_CHECKS.map(templateId));}
  expect((await two.read(A,"eurusd")).revision).toBe(5);expect((await one.exportSpace(A)).entries).toHaveLength(2);
  await expect(new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(r.error)})).rejects.toMatchObject({name:"VersionError"});
});
it("failed upgrade rolls back every prior cursor update and keeps the entire V1 database",async()=>{
  const {name,one}=setup();await seedV1(name,[legacy(A),legacy(B)]);const original=IDBCursorWithValue.prototype.update;let calls=0;
  const update=vi.spyOn(IDBCursorWithValue.prototype,"update").mockImplementation(function(this:IDBCursorWithValue,...args:Parameters<IDBCursorWithValue["update"]>){if(++calls===2)throw new DOMException("Quota","QuotaExceededError");return original.apply(this,args)});
  await expect(one.read(A,"eurusd")).rejects.toThrow();update.mockRestore();const snapshot=await one.exportSpace(A);expect(snapshot.databaseVersion).toBe(1);expect(snapshot.entries).toEqual([legacy(A)]);expect((await one.exportSpace(B)).entries).toEqual([legacy(B)]);
});
it("invalid and future documents survive upgrade without speculative repair",async()=>{
  const {name,one}=setup();const broken={...legacy(A),revision:"broken"},future={...legacy(B),version:9};await seedV1(name,[broken,future]);
  await expect(one.read(A,"eurusd")).rejects.toMatchObject({kind:"invalid"});await expect(one.read(B,"eurusd")).rejects.toMatchObject({kind:"unsupported"});expect((await one.exportSpace(A)).entries).toEqual([broken]);expect((await one.exportSpace(B)).entries).toEqual([future]);
});
it("V1 extension names that collide with the new checklist schema are preserved, not overwritten",async()=>{
  const {name,one}=setup(),raw={...legacy(A),checklist:{...legacy(A).checklist,items:{unknown:true}}};await seedV1(name,[raw]);await expect(one.read(A,"eurusd")).rejects.toMatchObject({kind:"invalid"});expect((await one.exportSpace(A)).entries).toEqual([raw]);
});
it("creates, edits and reorders stable item identities without changing their checks",async()=>{
  const {one,two}=setup(),id=uuid(1);await one.patch(A,"eurusd",{add:id,text:"  My manual condition  "});let row=await two.patch(A,"eurusd",{check:id,value:true});
  const item=row.checklist.items.find(i=>i.id===id)!;row=await one.patch(A,"eurusd",{rename:id,text:"Revised title",itemRevision:item.revision});expect(row.checklist.items.find(i=>i.id===id)).toMatchObject({text:"Revised title",checked:true});
  row=await two.patch(A,"eurusd",{move:id,step:-1,orderRevision:row.checklist.orderRevision});expect(row.checklist.items.at(-2)?.id).toBe(id);expect(row.checklist.items.at(-2)?.checked).toBe(true);
  const snap=await one.read(A,"eurusd");const reset=await one.reset(A,"eurusd",snap.revision);expect(reset.kind).toBe("saved");expect(reset.entry.checklist.items.map(i=>[i.id,i.text])).toEqual(snap.checklist.items.map(i=>[i.id,i.text]));expect(reset.entry.checklist.items.every(i=>!i.checked)).toBe(true);
});
it("concurrent adds preserve both items, a removed item cannot be resurrected by a stale toggle",async()=>{
  const {one,two}=setup();await Promise.all([one.patch(A,"eurusd",{add:uuid(2),text:"First"}),two.patch(A,"eurusd",{add:uuid(3),text:"Second"})]);let row=await one.read(A,"eurusd");expect(row.checklist.items).toHaveLength(8);
  const item=row.checklist.items.find(i=>i.id===uuid(2))!;await one.patch(A,"eurusd",{remove:item.id,itemRevision:item.revision});await expect(two.patch(A,"eurusd",{check:item.id,value:true})).rejects.toMatchObject({kind:"conflict"});row=await one.read(A,"eurusd");expect(row.checklist.items.some(i=>i.id===item.id)).toBe(false);
});
it("concurrent edits/deletes/moves require the reviewed item/order version",async()=>{
  const {one,two}=setup();let row=await one.patch(A,"eurusd",{check:"reaction",value:true});const item=row.checklist.items.at(-1)!;
  await two.patch(A,"eurusd",{rename:item.id,text:"Updated elsewhere",itemRevision:item.revision});await expect(one.patch(A,"eurusd",{remove:item.id,itemRevision:item.revision})).rejects.toMatchObject({kind:"conflict"});
  const order=row.checklist.orderRevision;row=await two.patch(A,"eurusd",{move:item.id,step:-1,orderRevision:order});await expect(one.patch(A,"eurusd",{move:row.checklist.items[0].id,step:1,orderRevision:order})).rejects.toMatchObject({kind:"conflict"});expect(focusChecked(row,"reaction")).toBe(true);
});
it("limits count atomically, including two tabs competing for the final slot",async()=>{
  const {one,two}=setup();for(let i=0;i<FOCUS_ITEM_LIMIT-7;i++)await one.patch(A,"eurusd",{add:uuid(100+i),text:`Condition ${i}`});
  const outcomes=await Promise.allSettled([one.patch(A,"eurusd",{add:uuid(500),text:"Last one"}),two.patch(A,"eurusd",{add:uuid(501),text:"Another"})]);expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await one.read(A,"eurusd")).checklist.items).toHaveLength(30);
  expect(()=>patchFocus(emptyFocus(A,"eurusd"),{add:uuid(10),text:"😀".repeat(161)})).toThrow("text");expect(patchFocus(emptyFocus(A,"eurusd"),{add:uuid(10),text:"😀".repeat(160)}).checklist.items.at(-1)?.text).toHaveLength(320);
  for(const text of ["  ","line\nline","x".repeat(161)])await expect(two.patch(B,"eurusd",{add:uuid(11),text})).rejects.toMatchObject({kind:"text"});
});
it("exports just the chosen space and fences old-controller writes after profile purge",async()=>{
  const {one,two}=setup();await one.patch(A,"eurusd",{add:uuid(5),text:"Private A"});await one.patch(B,"eurusd",{add:uuid(6),text:"Private B"});await one.select(A,"gold");const ticket=await two.epoch(A);
  const exported=await one.exportSpace(A);expect(JSON.stringify(exported)).toContain("Private A");expect(JSON.stringify(exported)).not.toContain("Private B");expect(exported.preferences).toMatchObject({selectedInstrumentId:"gold"});
  await one.clearSpace(A);await expect(two.patch(A,"eurusd",{check:"reaction",value:true},ticket)).rejects.toMatchObject({kind:"cleared"});await expect(two.select(A,"gold",ticket)).rejects.toMatchObject({kind:"cleared"});
  expect((await one.exportSpace(A)).entries).toEqual([]);expect((await one.exportSpace(A)).preferences).toBeNull();expect((await one.exportSpace(B)).entries).toHaveLength(1);
});
it("cleanup abort leaves both data and the purge fence unchanged",async()=>{
  const {one}=setup();await one.patch(A,"eurusd",{check:"reaction",value:true});const epoch=await one.epoch(A);const original=IDBObjectStore.prototype.delete;
  const remove=vi.spyOn(IDBObjectStore.prototype,"delete").mockImplementationOnce(()=>{throw new DOMException("Denied","AbortError")});
  // Throwing during a request handler aborts the transaction; no partial entry/preferences cleanup.
  await expect(one.clearSpace(A)).rejects.toThrow();remove.mockRestore();expect(await one.epoch(A)).toBe(epoch);expect(focusChecked(await one.read(A,"eurusd"),"reaction")).toBe(true);expect(original).toBeTruthy();
});
it("profile export/cleanup include Focus, leave other spaces and ordinary logout intact",async()=>{
  await focusStorage.patch("guest","eurusd",{add:uuid(8),text:"Guest entry"});await focusStorage.patch(A,"gold",{add:uuid(9),text:"Account entry"});AppStorage.setUserId(B.slice(8));
  const payload=await exportGuestData();expect(JSON.stringify(payload.marketFocus)).toContain("Guest entry");expect(JSON.stringify(payload.marketFocus)).not.toContain("Account entry");
  await deleteGuestData();expect((await focusStorage.exportSpace("guest")).entries).toEqual([]);expect((await focusStorage.exportSpace(A)).entries).toHaveLength(1);
  AppStorage.setUserId(A.slice(8));await expect(deleteAccountDeviceData(A.slice(8))).rejects.toThrow();AppStorage.setUserId(null);expect((await focusStorage.exportSpace(A)).entries).toHaveLength(1);await deleteAccountDeviceData(A.slice(8));expect((await focusStorage.exportSpace(A)).entries).toEqual([]);
});
