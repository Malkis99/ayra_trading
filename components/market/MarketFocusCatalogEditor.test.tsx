import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
