import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { emptyFocus } from "@/lib/market/market-focus";
import { alertsOf } from "@/lib/market/focus-notifications";
import { defaultSettings } from "@/lib/notifications/types";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { MarketFocusNotifications } from "./MarketFocusNotifications";

const mock = vi.hoisted(() => ({ epoch: vi.fn(), read: vi.fn(), exportSpace: vi.fn(), claimAlert: vi.fn(), settings: vi.fn(), notice: undefined as undefined | ((event: {spaceId:string;instrumentId:string|null}) => void) }));
vi.mock("@/lib/context", () => ({ useApp: () => ({ dict: en }) }));
vi.mock("@/lib/storage/market-focus", () => ({ focusStorage: mock, subscribeFocus: (fn: typeof mock.notice) => { mock.notice = fn; return () => { mock.notice = undefined; }; } }));
vi.mock("@/lib/notifications/repository", () => ({ notificationRepository: { settings: mock.settings } }));
const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002",space=`account:${A}`;
const policy = { settings: defaultSettings(), preferences: [] };
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
beforeEach(()=>{
  vi.clearAllMocks();AppStorage.setUserId(A);vi.spyOn(document,"hidden","get").mockReturnValue(false);
  const entry=emptyFocus(space,"eurusd");entry.revision=1;entry.checklist.items=entry.checklist.items.map(i=>({...i,checked:true}));entry.localAlerts={...alertsOf(entry),completion:true,enabledAt:Date.now()-100,completionEvent:{at:Date.now(),revision:1}};
  mock.epoch.mockResolvedValue(0);mock.read.mockResolvedValue(entry);mock.exportSpace.mockResolvedValue({entries:[entry]});mock.settings.mockResolvedValue(policy);mock.claimAlert.mockResolvedValue(true);
});
afterEach(()=>{cleanup();AppStorage.setUserId(null);vi.restoreAllMocks();});
const mount=()=>render(<MarketFocusNotifications space={space} id="eurusd" ids={["eurusd"]}/>);
it("never delivers or claims a late policy response after A → B → A",async()=>{
  const pending=deferred<typeof policy>();mock.settings.mockReturnValue(pending.promise);mount();await waitFor(()=>expect(mock.settings).toHaveBeenCalledTimes(1));
  act(()=>{AppStorage.setUserId(B);spaceTabChannel.notifyLocal(space,`account:${B}`);AppStorage.setUserId(A);spaceTabChannel.notifyLocal(`account:${B}`,space);});
  await act(async()=>{pending.resolve(policy);await pending.promise;});expect(mock.claimAlert).not.toHaveBeenCalled();expect(screen.queryByTestId("focus-alert-message")).toBeNull();
});
it("never reports delivery for a failed or unconfirmed claim",async()=>{
  mock.claimAlert.mockResolvedValue(false);mount();await waitFor(()=>expect(mock.claimAlert).toHaveBeenCalledTimes(1));expect(screen.queryByTestId("focus-alert-message")).toBeNull();
});
it("purge invalidates an in-flight successful claim before its response can display a cue",async()=>{
  const pending=deferred<boolean>();mock.claimAlert.mockReturnValue(pending.promise);mount();await waitFor(()=>expect(mock.claimAlert).toHaveBeenCalledTimes(1));
  act(()=>mock.notice?.({spaceId:space,instrumentId:null}));await act(async()=>{pending.resolve(true);await pending.promise;});expect(screen.queryByTestId("focus-alert-message")).toBeNull();
});
