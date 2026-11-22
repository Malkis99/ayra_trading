import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusStorage } from "./market-focus";
import { emptyFocus, focusChecked, FOCUS_CHECKS, FOCUS_FIELDS, parseFocus, patchFocus } from "@/lib/market/market-focus";

const A = "account:00000000-0000-4000-8000-000000002201", B = "account:00000000-0000-4000-8000-000000002202";
let counter = 0;
const storage = () => { const name = `focus-test-${++counter}`; return { name, one: new FocusStorage(name), two: new FocusStorage(name) }; };
async function rawWrite(name: string, raw: unknown) {
  const db = await new Promise<IDBDatabase>((resolve,reject) => { const r = indexedDB.open(name,2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").put(raw);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
}
afterEach(()=>{ vi.restoreAllMocks(); });
describe("Market Focus isolated local transactions",()=>{
  it("empty navigation is read-only, has no implicit assessment, distinguishes null/none", async()=>{
    const {one}=storage();const entry=await one.read(A,"eurusd");expect(entry).toEqual(emptyFocus(A,"eurusd"));
    expect(entry.session).toBeNull();expect((await one.patch(A,"eurusd",{field:"session",value:"none"})).session).toBe("none");
  });
  for(const field of Object.keys(FOCUS_FIELDS) as (keyof typeof FOCUS_FIELDS)[]) it(`validates every ${field} option without creating a signal`,async()=>{
    const {one,two}=storage();for(const value of FOCUS_FIELDS[field]){await one.patch(A,"eurusd",{field,value} as Parameters<FocusStorage["patch"]>[2]);expect((await two.read(A,"eurusd"))[field]).toBe(value);}
    await one.patch(A,"eurusd",{field,value:null});expect((await two.read(A,"eurusd"))[field]).toBeNull();
  });
  for(const check of FOCUS_CHECKS) it(`persists explicit true/false for ${check}`,async()=>{
    const {one,two}=storage();await one.patch(A,"eurusd",{check,value:true});expect(focusChecked(await two.read(A,"eurusd"),check)).toBe(true);
    await one.patch(A,"eurusd",{check,value:false});expect(focusChecked(await two.read(A,"eurusd"),check)).toBe(false);
  });
  it("A → B → Guest → A and instruments never copy or overwrite each other",async()=>{
    const {one,two}=storage();await one.patch(A,"eurusd",{field:"direction",value:"bullish"});await one.patch(B,"eurusd",{field:"direction",value:"bearish"});await one.patch("guest","eurusd",{field:"poi",value:"fvg"});
    expect((await two.read(A,"eurusd")).direction).toBe("bullish");expect((await two.read(B,"eurusd")).direction).toBe("bearish");expect((await two.read("guest","eurusd")).direction).toBeNull();expect((await two.read(A,"gold")).direction).toBeNull();
    await one.select(A,"gold");await one.select(B,"eurusd");expect(await two.selection(A)).toBe("gold");expect(await two.selection("guest")).toBeNull();
  });
  it("two connections preserve different fields, checks and instruments atomically",async()=>{
    const {one,two}=storage();await Promise.all([one.patch(A,"eurusd",{field:"direction",value:"bullish"}),two.patch(A,"eurusd",{field:"poi",value:"fvg"}),one.patch(A,"eurusd",{check:"reaction",value:true}),two.patch(A,"gold",{field:"mss",value:"waiting"})]);
    expect(await one.read(A,"eurusd")).toMatchObject({revision:3,direction:"bullish",poi:"fvg"});expect(focusChecked(await one.read(A,"eurusd"),"reaction")).toBe(true);expect((await one.read(A,"gold")).revision).toBe(1);
  });
  it("serializes rapid true → false → true in transaction order",async()=>{
    const {one,two}=storage();await Promise.all([one.patch(A,"eurusd",{check:"reaction",value:true}),two.patch(A,"eurusd",{check:"reaction",value:false}),one.patch(A,"eurusd",{check:"reaction",value:true})]);
    expect((await two.read(A,"eurusd")).revision).toBe(3);expect(focusChecked(await two.read(A,"eurusd"),"reaction")).toBe(true);
  });
  it("reset uses a revision fence and never erases an unreviewed concurrent update",async()=>{
    const {one,two}=storage();await one.patch(A,"eurusd",{field:"mss",value:"bullish"});const snapshot=await one.read(A,"eurusd");await two.patch(A,"eurusd",{check:"reaction",value:true});
    const conflict=await one.reset(A,"eurusd",snapshot.revision);expect(conflict.kind).toBe("conflict");expect(focusChecked(conflict.entry,"reaction")).toBe(true);
    expect((await one.reset(A,"eurusd",conflict.entry.revision)).kind).toBe("saved");const cleared=await two.read(A,"eurusd");expect(cleared).toMatchObject({mss:null,revision:3});expect(cleared.checklist.items.every(item=>!item.checked)).toBe(true);
  });
  it("two simultaneous resets of the same revision have exactly one winner",async()=>{
    const {one,two}=storage();await one.patch(A,"eurusd",{field:"direction",value:"neutral"});
    const outcomes=await Promise.all([one.reset(A,"eurusd",1),two.reset(A,"eurusd",1)]);
    expect(outcomes.map(r=>r.kind).sort()).toEqual(["conflict","saved"]);expect((await one.read(A,"eurusd")).revision).toBe(2);
  });
  it("a successful put request followed by transaction abort is not a successful save",async()=>{
    const {one}=storage();await one.patch(A,"eurusd",{field:"direction",value:"bullish"});
    const original=IDBObjectStore.prototype.put;
    const put=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){
      const request=original.apply(this,args),tx=this.transaction;request.addEventListener("success",()=>tx.abort());return request;
    });
    await expect(one.patch(A,"eurusd",{field:"direction",value:"bearish"})).rejects.toThrow();put.mockRestore();
    expect(await one.read(A,"eurusd")).toMatchObject({direction:"bullish",revision:1});
  });
  it("preserves opaque fields, unknown instruments, and does not downgrade a future contract",async()=>{
    const {name,one}=storage();await one.read(A,"eurusd");const raw={...emptyFocus(A,"eurusd"),revision:1,future:{keep:true},checklist:{...emptyFocus(A,"eurusd").checklist,extra:true}};await rawWrite(name,raw);
    expect(await one.patch(A,"eurusd",{field:"direction",value:"neutral"})).toMatchObject({future:{keep:true},checklist:{extra:true}});
    await rawWrite(name,{...raw,instrumentId:"futureinstrument",version:3});await one.patch(A,"gold",{field:"poi",value:"liquidity"});
    await rawWrite(name,{...raw,version:3});await expect(one.patch(A,"eurusd",{field:"poi",value:"fvg"})).rejects.toMatchObject({kind:"unsupported"});
    expect(()=>parseFocus({...raw,version:3},A,"eurusd")).toThrow("unsupported");
  });
  it("quota failure aborts the write, retains confirmed data, and never emits cloud events",async()=>{
    const {one}=storage();await one.patch(A,"eurusd",{field:"direction",value:"bullish"});const cloud=vi.fn();window.addEventListener("ayra-market-store",cloud);
    const put=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(()=>{throw new DOMException("Quota","QuotaExceededError");});
    await expect(one.patch(A,"eurusd",{field:"direction",value:"bearish"})).rejects.toThrow();put.mockRestore();expect((await one.read(A,"eurusd")).direction).toBe("bullish");expect(cloud).not.toHaveBeenCalled();window.removeEventListener("ayra-market-store",cloud);
  });
  it("unavailable IndexedDB rejects, invalid records are never silently replaced",async()=>{
    const {name,one}=storage();await one.read(A,"eurusd");await rawWrite(name,{...emptyFocus(A,"eurusd"),revision:1,direction:0});await expect(one.patch(A,"eurusd",{field:"direction",value:"bullish"})).rejects.toMatchObject({kind:"invalid"});
    const open=vi.spyOn(indexedDB,"open").mockImplementation(()=>{throw new DOMException("Denied","SecurityError");});await expect(one.read(A,"gold")).rejects.toThrow();open.mockRestore();
    expect(()=>patchFocus(emptyFocus(A,"eurusd"),{field:"direction",value:"signal"} as never)).toThrow();await expect(one.read("account:bad","eurusd")).rejects.toThrow();
  });
});
