import "fake-indexeddb/auto";
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { focusStorage } from "@/lib/storage/market-focus";
import { useFocusCatalog } from "./use-focus-catalog";
import type { CatalogSnapshot } from "./focus-catalog";
const A="00000000-0000-4000-8000-000000002781",B="00000000-0000-4000-8000-000000002782",space=`account:${A}`;
const empty=():CatalogSnapshot=>({catalog:{version:1,revision:0,items:[]},references:{},referencesKnown:true});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
const command={create:"00000000-0000-4000-8000-000000002783",kind:"poi" as const,label:"Custom type"};
let view:ReturnType<typeof useFocusCatalog>;
function Probe({scope}:{scope:string}){view=useFocusCatalog(scope,"eurusd");return <span>{view.pending?"pending":view.issue??"ready"}</span>;}
function change(user:string|null){const from=AppStorage.getActiveSpaceId();AppStorage.setUserId(user);spaceTabChannel.notifyLocal(from,AppStorage.getActiveSpaceId());}
afterEach(()=>{cleanup();vi.restoreAllMocks();AppStorage.setUserId(null);});
it("catalog acknowledges only a committed result and serializes rapid commands",async()=>{
  change(A);const gate=deferred<CatalogSnapshot>();vi.spyOn(focusStorage,"epoch").mockResolvedValue(0);vi.spyOn(focusStorage,"catalog").mockResolvedValue(empty());const write=vi.spyOn(focusStorage,"changeCatalog").mockReturnValue(gate.promise);
  render(<Probe scope={space}/>);await waitFor(()=>expect(view.snapshot).toBeDefined());let second:Promise<boolean>;act(()=>{void view.api!.change(command);second=view.api!.change(command);});expect(view.pending).toBe(true);expect(view.snapshot?.catalog.revision).toBe(0);expect(await second!).toBe(false);
  await act(async()=>{gate.resolve({...empty(),catalog:{version:1,revision:1,items:[]}});await gate.promise;});expect(write).toHaveBeenCalledTimes(1);expect(view.pending).toBe(false);expect(view.snapshot?.catalog.revision).toBe(1);
});
it("A → B → Guest → A invalidates an old catalog response even when the account ID returns",async()=>{
  change(A);const gate=deferred<CatalogSnapshot>();vi.spyOn(focusStorage,"epoch").mockResolvedValue(0);vi.spyOn(focusStorage,"catalog").mockResolvedValue(empty());const write=vi.spyOn(focusStorage,"changeCatalog").mockReturnValue(gate.promise);
  const rendered=render(<Probe key="a" scope={space}/>);await waitFor(()=>expect(view.snapshot).toBeDefined());act(()=>{void view.api!.change(command);});await waitFor(()=>expect(write).toHaveBeenCalledTimes(1));
  act(()=>{change(B);change(null);change(A);});rendered.rerender(<Probe key="a-again" scope={space}/>);await waitFor(()=>expect(view.snapshot).toBeDefined());expect(write.mock.calls[0][4]!()).toBe(false);
  await act(async()=>{gate.resolve({...empty(),catalog:{version:1,revision:99,items:[]}});await gate.promise;});expect(view.snapshot?.catalog.revision).toBe(0);expect(view.pending).toBe(false);
});
it("purge and explicit retry do not let an old acknowledgement clear a newer pending operation",async()=>{
  change(A);const one=deferred<CatalogSnapshot>(),two=deferred<CatalogSnapshot>();vi.spyOn(focusStorage,"epoch").mockResolvedValueOnce(0).mockResolvedValue(1);vi.spyOn(focusStorage,"catalog").mockResolvedValue(empty());const write=vi.spyOn(focusStorage,"changeCatalog").mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  render(<Probe scope={space}/>);await waitFor(()=>expect(view.snapshot).toBeDefined());act(()=>{void view.api!.change(command);window.dispatchEvent(new CustomEvent("ayra-market-focus-change",{detail:{spaceId:space,instrumentId:null}}));});expect(view.issue).toBe("cleared");act(()=>view.api!.reload());await waitFor(()=>expect(view.issue).toBeUndefined());
  act(()=>{void view.api!.change(command);});await waitFor(()=>expect(write).toHaveBeenCalledTimes(2));await act(async()=>{one.resolve({...empty(),catalog:{version:1,revision:88,items:[]}});await one.promise;});expect(view.pending).toBe(true);expect(view.snapshot?.catalog.revision).toBe(0);
  await act(async()=>{two.resolve({...empty(),catalog:{version:1,revision:1,items:[]}});await two.promise;});expect(view.pending).toBe(false);expect(view.snapshot?.catalog.revision).toBe(1);
});
it("failed catalog writes never advance the confirmed library",async()=>{
  change(A);vi.spyOn(focusStorage,"epoch").mockResolvedValue(0);vi.spyOn(focusStorage,"catalog").mockResolvedValue(empty());vi.spyOn(focusStorage,"changeCatalog").mockRejectedValue(new Error("quota"));render(<Probe scope={space}/>);await waitFor(()=>expect(view.snapshot).toBeDefined());await act(async()=>{expect(await view.api!.change(command)).toBe(false);});expect(view.issue).toBe("storage");expect(view.snapshot?.catalog.revision).toBe(0);expect(view.pending).toBe(false);
});
