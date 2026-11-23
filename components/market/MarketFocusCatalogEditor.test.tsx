import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import type { CatalogSnapshot } from "@/lib/market/focus-catalog";
import { MarketFocusCatalogEditor } from "./MarketFocusCatalogEditor";

vi.mock("@/lib/context", () => ({ useApp: () => ({ dict: en, lang: "en" }), useOptionalApp: () => ({ dict: en, lang: "en" }) }));
afterEach(cleanup);
it("shows an unknown newer instrument reference by its stable ID without discarding or crashing",()=>{
  const id="00000000-0000-4000-8000-000000002998";
  const snapshot:CatalogSnapshot={catalog:{version:1,revision:1,items:[{version:1,spaceId:"guest",kind:"poi",id,revision:1,label:"Shared zone",deleted:false}]},references:{[id]:["future-instrument"]},referencesKnown:true};
  const change=vi.fn().mockResolvedValue(true);
  render(<MarketFocusCatalogEditor field="poi" snapshot={snapshot} pending={false} change={change} reload={vi.fn()} close={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:`${en.market.focus.catalog.remove}: Shared zone`}));
  expect(screen.getByRole("dialog").textContent).toContain("future-instrument");
  expect(snapshot.references[id]).toEqual(["future-instrument"]);expect(change).not.toHaveBeenCalled();
});
it("renaming a legacy session keeps its V1 schedule absent until a schedule control is explicitly changed",async()=>{
  const id="00000000-0000-4000-8000-000000002997";
  const snapshot:CatalogSnapshot={catalog:{version:1,revision:1,items:[{version:1,spaceId:"guest",kind:"session",id,revision:1,label:"Legacy",deleted:false,session:{start:"08:00",end:"17:00",zone:"UTC"}}]},references:{},referencesKnown:true};
  const change=vi.fn().mockResolvedValue(true);render(<MarketFocusCatalogEditor field="session" snapshot={snapshot} pending={false} change={change} reload={vi.fn()} close={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Edit: Legacy"}));fireEvent.change(screen.getByTestId("focus-catalog-name"),{target:{value:"Renamed"}});fireEvent.click(screen.getByTestId("focus-catalog-save"));
  await waitFor(()=>expect(change).toHaveBeenCalledTimes(1));expect(change.mock.calls[0][0].session.reminders).toBeUndefined();
  fireEvent.click(screen.getByRole("button",{name:"Edit: Legacy"}));fireEvent.click(screen.getByRole("checkbox",{name:"Sat"}));fireEvent.click(screen.getByTestId("focus-catalog-save"));
  await waitFor(()=>expect(change).toHaveBeenCalledTimes(2));expect(change.mock.calls[1][0].session.reminders).toMatchObject({enabled:false,days:[1,2,3,4,5,6]});
});
it("keeps the confirmed enabled schedule visible and never displays saved before the transaction acknowledgement",async()=>{
  let resolve!:(ok:boolean)=>void;const pending=new Promise<boolean>(r=>{resolve=r;});
  const snapshot:CatalogSnapshot={catalog:{version:1,revision:0,items:[]},references:{},referencesKnown:true};
  render(<MarketFocusCatalogEditor field="session" snapshot={snapshot} pending={false} change={()=>pending} reload={vi.fn()} close={vi.fn()}/>);
  fireEvent.change(screen.getByTestId("focus-catalog-name"),{target:{value:"My session"}});fireEvent.change(screen.getByTestId("focus-session-start"),{target:{value:"08:00"}});fireEvent.change(screen.getByTestId("focus-session-end"),{target:{value:"17:00"}});fireEvent.click(screen.getByTestId("focus-custom-session-enabled"));fireEvent.click(screen.getByTestId("focus-catalog-save"));
  expect(screen.queryByText(en.market.focus.catalog.saved)).toBeNull();await act(async()=>{resolve(true);await pending;});
  await screen.findByText(en.market.focus.catalog.saved);expect((screen.getByTestId("focus-custom-session-enabled") as HTMLInputElement).checked).toBe(true);
});
