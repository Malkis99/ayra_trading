/** Architecture evidence only: no custom runtime, real database upgrade or new notification producer. */
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { emptyFocus, parseFocus, patchFocus, type FocusField } from "./market-focus";
import { FocusStorage } from "@/lib/storage/market-focus";
import { instantOf, wallAt } from "./sessions";

const id = "custom:00000000-0000-4000-8000-000000000001";
it.each(["direction","poi","mss","session"] as FocusField[])("V2 cannot accept a custom %s identifier",field=>{
  const row={...emptyFocus("guest","eurusd"),revision:1,[field]:id};
  expect(()=>parseFocus(row,"guest","eurusd")).toThrow("market_focus_invalid");
  // Model the untyped input an old client would receive from a future record.
  expect(()=>patchFocus(emptyFocus("guest","eurusd"),{field,value:id} as never)).toThrow("market_focus_invalid");
});
it("a V2 sidecar cannot distinguish explicit custom POI clear from an unrelated legacy field clear",()=>{
  const row={...emptyFocus("guest","eurusd"),revision:1,customSelections:{version:1,poi:id}};
  const clearCustomIntent=patchFocus(row,{field:"poi",value:null});
  const keepCustomIntent=patchFocus(row,{field:"mss",value:null});
  expect(clearCustomIntent).toEqual(keepCustomIntent);
  expect(clearCustomIntent.customSelections).toEqual({version:1,poi:id});
});
it("a new record version is read-only to the deployed V2 model",()=>{
  const row={...emptyFocus("guest","eurusd"),revision:1,version:3};
  expect(()=>parseFocus(row,"guest","eurusd")).toThrow("market_focus_unsupported");
});
it("a database version gate preserves rows but also blocks the V2 reader and exporter",async()=>{
  const name=`watch2d-architecture-${crypto.randomUUID()}`,row={...emptyFocus("guest","eurusd"),revision:1};
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,2);r.onupgradeneeded=()=>{r.result.createObjectStore("entries",{keyPath:["spaceId","instrumentId"]});r.result.createObjectStore("preferences",{keyPath:"spaceId"});r.result.createObjectStore("spaces",{keyPath:"spaceId"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").put(row);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  const newer=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,3);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const preserved=await new Promise(resolve=>{const tx=newer.transaction("entries","readonly"),r=tx.objectStore("entries").get(["guest","eurusd"]);tx.oncomplete=()=>resolve(r.result);});newer.close();expect(preserved).toEqual(row);
  const old=new FocusStorage(name);await expect(old.read("guest","eurusd")).rejects.toMatchObject({kind:"storage"});await expect(old.exportSpace("guest")).rejects.toMatchObject({kind:"unsupported"});
});
it("a narrower record gate can keep DB V2, legacy selection/export/cleanup and unaffected instruments working",async()=>{
  const name=`watch2d-record-gate-${crypto.randomUUID()}`;
  const custom={...emptyFocus("guest","eurusd"),revision:1,version:3};
  const catalog={version:1,revision:1,items:[{kind:"poi",id,label:"Breaker Block",revision:1,deleted:false}]};
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,2);r.onupgradeneeded=()=>{r.result.createObjectStore("entries",{keyPath:["spaceId","instrumentId"]});r.result.createObjectStore("preferences",{keyPath:"spaceId"});r.result.createObjectStore("spaces",{keyPath:"spaceId"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(["entries","preferences"],"readwrite");tx.objectStore("entries").put(custom);tx.objectStore("preferences").put({version:1,spaceId:"guest",selectedInstrumentId:"eurusd",customCatalog:catalog});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  const old=new FocusStorage(name);await old.select("guest","gold");
  const snapshot=await old.exportSpace("guest");expect(snapshot.databaseVersion).toBe(2);expect(snapshot.entries).toEqual([custom]);expect(snapshot.preferences).toMatchObject({selectedInstrumentId:"gold",customCatalog:catalog});
  expect((await old.read("guest","gold")).version).toBe(2);
  await expect(old.patch("guest","eurusd",{field:"poi",value:null})).rejects.toMatchObject({kind:"unsupported"});
  expect((await old.exportSpace("guest")).entries).toEqual([custom]);
  await old.clearSpace("guest");expect(await old.exportSpace("guest")).toEqual({databaseVersion:2,entries:[],preferences:null});
});
it.each([
  ["Europe/London",2026,3,29,1,30], ["America/New_York",2026,3,8,2,30],
] as const)("existing fixed-session helper does not reject a nonexistent custom wall time in %s",(zone,y,mo,d,h,m)=>{
  const actual=wallAt(instantOf(y,mo,d,h,m,zone),zone);
  expect([actual.y,actual.mo,actual.d,actual.h,actual.mi]).not.toEqual([y,mo,d,h,m]);
});
it.each([
  ["Europe/London","2026-10-25T00:30:00Z","2026-10-25T01:30:00Z"],
  ["America/New_York","2026-11-01T05:30:00Z","2026-11-01T06:30:00Z"],
] as const)("custom schedules need an explicit fold policy: two UTC instants share the wall clock in %s",(zone,a,b)=>{
  expect(wallAt(Date.parse(a),zone)).toEqual(wallAt(Date.parse(b),zone));expect(Date.parse(a)).not.toBe(Date.parse(b));
});
