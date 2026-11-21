import "fake-indexeddb/auto";
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { focusStorage } from "@/lib/storage/market-focus";
import { emptyFocus } from "./market-focus";
import { useMarketFocus } from "./use-market-focus";
const A="00000000-0000-4000-8000-000000002231",B="00000000-0000-4000-8000-000000002232";
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
let api:ReturnType<typeof useMarketFocus>;
function Probe({space}:{space:string}){api=useMarketFocus(space,"eurusd");return <span>{api.issue??(api.pending?"pending":api.entry?`confirmed:${api.entry.direction}:${api.entry.revision}`:"loading")}</span>}
function change(user:string|null){const from=AppStorage.getActiveSpaceId();AppStorage.setUserId(user);spaceTabChannel.notifyLocal(from,AppStorage.getActiveSpaceId());}
afterEach(()=>{cleanup();vi.restoreAllMocks();AppStorage.setUserId(null);});
it("does not confirm an optimistic change before commit or erase newer rapid intent",async()=>{
  change(A);const space=`account:${A}`,one=deferred<ReturnType<typeof emptyFocus>>(),two=deferred<ReturnType<typeof emptyFocus>>();
  vi.spyOn(focusStorage,"read").mockResolvedValue(emptyFocus(space,"eurusd"));vi.spyOn(focusStorage,"patch").mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  render(<Probe space={space}/>);await waitFor(()=>expect(api.entry).toBeDefined());
  act(()=>{api.api!.patch({field:"direction",value:"bullish"});api.api!.patch({field:"direction",value:"bearish"});});expect(screen.getByText("pending")).toBeTruthy();expect(api.entry?.direction).toBe("bearish");
  await act(async()=>{one.resolve({...emptyFocus(space,"eurusd"),direction:"bullish",revision:1});await one.promise;});expect(screen.getByText("pending")).toBeTruthy();expect(api.entry?.direction).toBe("bearish");
  await act(async()=>{two.resolve({...emptyFocus(space,"eurusd"),direction:"bearish",revision:2});await two.promise;});await waitFor(()=>expect(screen.getByText("confirmed:bearish:2")).toBeTruthy());
});
it("A's delayed read never paints B, Guest or a new A epoch",async()=>{
  const gate=deferred<ReturnType<typeof emptyFocus>>();change(A);const a=`account:${A}`,b=`account:${B}`;
  vi.spyOn(focusStorage,"read").mockReturnValueOnce(gate.promise).mockImplementation(async(space,id)=>emptyFocus(space,id));
  const view=render(<Probe key="A1" space={a}/>);act(()=>change(B));view.rerender(<Probe key="B" space={b}/>);await waitFor(()=>expect(api.entry?.spaceId).toBe(b));
  act(()=>change(null));view.rerender(<Probe key="guest" space="guest"/>);await waitFor(()=>expect(api.entry?.spaceId).toBe("guest"));
  act(()=>change(A));view.rerender(<Probe key="A2" space={a}/>);await waitFor(()=>expect(api.entry?.spaceId).toBe(a));
  await act(async()=>{gate.resolve({...emptyFocus(a,"eurusd"),direction:"bearish",revision:99});await gate.promise;});expect(api.entry?.direction).toBeNull();expect(api.entry?.revision).toBe(0);
});
it("an accepted A write stays bound to A and a late failed acknowledgement cannot mark B",async()=>{
  change(A);const gate=deferred<ReturnType<typeof emptyFocus>>(),a=`account:${A}`,b=`account:${B}`;
  vi.spyOn(focusStorage,"read").mockImplementation(async(space,id)=>emptyFocus(space,id));const write=vi.spyOn(focusStorage,"patch").mockReturnValue(gate.promise);
  const view=render(<Probe key="a" space={a}/>);await waitFor(()=>expect(api.entry).toBeDefined());act(()=>api.api!.patch({field:"poi",value:"fvg"}));
  act(()=>change(B));view.rerender(<Probe key="b" space={b}/>);await waitFor(()=>expect(api.entry?.spaceId).toBe(b));
  await act(async()=>{gate.resolve({...emptyFocus(a,"eurusd"),poi:"fvg",revision:1});await gate.promise;});expect(write).toHaveBeenCalledWith(a,"eurusd",{field:"poi",value:"fvg"});expect(api.entry?.poi).toBeNull();expect(api.pending).toBe(false);
});
it("failed writes never report saved, retain the confirmed document and allow explicit re-read",async()=>{
  change(null);vi.spyOn(focusStorage,"read").mockResolvedValue({...emptyFocus("guest","eurusd"),direction:"bullish",revision:1});vi.spyOn(focusStorage,"patch").mockRejectedValue(new Error("quota"));
  render(<Probe space="guest"/>);await waitFor(()=>expect(api.entry).toBeDefined());act(()=>api.api!.patch({field:"direction",value:"bearish"}));
  await waitFor(()=>expect(api.issue).toBe("storage"));expect(api.entry?.direction).toBe("bullish");act(()=>api.api!.reload());await waitFor(()=>expect(api.issue).toBeUndefined());
});
