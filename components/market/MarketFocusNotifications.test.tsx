import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { emptyFocus, patchFocus } from "@/lib/market/market-focus";
import { defaultSessionReminder } from "@/lib/market/custom-session-time";
import { recordCustomClaim } from "@/lib/market/custom-session-alerts";
import { alertsOf } from "@/lib/market/focus-notifications";
import { defaultSettings } from "@/lib/notifications/types";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { MarketFocusNotifications } from "./MarketFocusNotifications";

const mock = vi.hoisted(() => ({ epoch: vi.fn(), read: vi.fn(), exportSpace: vi.fn(), claimAlert: vi.fn(), currentCustomAlert:vi.fn(), settings: vi.fn(), notice: undefined as undefined | ((event: {spaceId:string;instrumentId:string|null}) => void), scopeListeners:new Set<(message:{fromSpaceId:string;toSpaceId:string})=>void>() }));
vi.mock("@/lib/context", () => ({ useApp: () => ({ dict: en }) }));
vi.mock("@/lib/storage/market-focus", () => ({ focusStorage: mock, subscribeFocus: (fn: typeof mock.notice) => { mock.notice = fn; return () => { mock.notice = undefined; }; } }));
vi.mock("@/lib/notifications/repository", () => ({ notificationRepository: { settings: mock.settings } }));
// Node BroadcastChannel crosses Vitest worker threads, unlike isolated browser contexts.
// Keep the real account guard, but drive its channel explicitly inside this unit fixture.
vi.mock("@/lib/auth/space-channel",()=>({spaceTabChannel:{
  subscribe:(handler:(message:{fromSpaceId:string;toSpaceId:string})=>void)=>{mock.scopeListeners.add(handler);return()=>{mock.scopeListeners.delete(handler);};},
  notifyLocal:(fromSpaceId:string,toSpaceId:string)=>{for(const handler of mock.scopeListeners)handler({fromSpaceId,toSpaceId});},
}}));
const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002",space=`account:${A}`;
const policy = { settings: defaultSettings(), preferences: [] };
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
beforeEach(()=>{
  vi.clearAllMocks();AppStorage.setUserId(A);vi.spyOn(document,"hidden","get").mockReturnValue(false);
  const entry=emptyFocus(space,"eurusd");entry.revision=1;entry.checklist.items=entry.checklist.items.map(i=>({...i,checked:true}));entry.localAlerts={...alertsOf(entry),completion:true,enabledAt:Date.now()-100,completionEvent:{at:Date.now(),revision:1}};
  mock.epoch.mockResolvedValue(0);mock.read.mockResolvedValue(entry);mock.exportSpace.mockResolvedValue({entries:[entry]});mock.settings.mockResolvedValue(policy);mock.claimAlert.mockResolvedValue(true);
});
afterEach(()=>{cleanup();expect(mock.scopeListeners.size).toBe(0);AppStorage.setUserId(null);vi.restoreAllMocks();vi.useRealTimers();});
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
const customDue=Date.parse("2026-03-30T06:55Z");
async function customMount(now=customDue-60000){
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  const id="00000000-0000-4000-8000-000000002811";
  const entry={...patchFocus(emptyFocus(space,"eurusd"),{custom:"session",id,entryRevision:0,fieldRevision:0,catalogRevision:1}),revision:1};
  mock.read.mockResolvedValue(entry);mock.exportSpace.mockResolvedValue({entries:[entry],preferences:{version:1,spaceId:space,selectedInstrumentId:"eurusd",customCatalog:{version:2,revision:1,items:[{version:1,spaceId:space,kind:"session",id,revision:1,label:"Custom London",deleted:false,session:{start:"08:00",end:"17:00",zone:"Europe/London",reminders:{...defaultSessionReminder(),enabled:true,armedAt:customDue-3600000}}}]}}});
  mock.currentCustomAlert.mockResolvedValue(true);const view=mount();await waitFor(()=>expect((screen.getByRole("checkbox",{name:en.market.focus.alerts.enableCompletion}) as HTMLInputElement).disabled).toBe(false));return view;
}
const tickCustom=async()=>{vi.setSystemTime(customDue);await act(async()=>{fireEvent.focus(window);});};
it.each(["master","quiet","instrument","type","network"])("custom reminders respect the existing %s policy",async kind=>{
  await customMount();const settings={...defaultSettings(),...(kind==="master"?{all_disabled:true}:kind==="quiet"?{quiet_enabled:true,quiet_start:"00:00",quiet_end:"23:59"}:kind==="instrument"?{instrument_ids:["gold"]}:{})};
  if(kind==="network")mock.settings.mockRejectedValue(new Error("policy unavailable"));else mock.settings.mockResolvedValue({settings,preferences:kind==="type"?[{type_code:"session_open",channel_code:"site",enabled:false}]:[]});await tickCustom();
  await waitFor(()=>expect(screen.getByText(en.market.focus.alerts.paused)).toBeTruthy());expect(mock.claimAlert).not.toHaveBeenCalled();
});
it("late opening or a hidden-page interval never replays a custom reminder",async()=>{
  const view=await customMount(customDue+1);await act(async()=>{fireEvent.focus(window);});expect(mock.claimAlert).not.toHaveBeenCalled();view.unmount();
  mock.exportSpace.mockClear();await customMount();vi.spyOn(document,"hidden","get").mockReturnValue(true);fireEvent(document,new Event("visibilitychange"));vi.setSystemTime(customDue+1);vi.spyOn(document,"hidden","get").mockReturnValue(false);
  await act(async()=>{fireEvent(document,new Event("visibilitychange"));});expect(mock.claimAlert).not.toHaveBeenCalled();
});
it("custom pending policy replies never cross A → B → Guest → A",async()=>{
  await customMount();const pending=deferred<typeof policy>();mock.settings.mockReturnValue(pending.promise);await tickCustom();await waitFor(()=>expect(mock.settings).toHaveBeenCalled());
  act(()=>{AppStorage.setUserId(B);spaceTabChannel.notifyLocal(space,`account:${B}`);AppStorage.setUserId(null);spaceTabChannel.notifyLocal(`account:${B}`,"guest");AppStorage.setUserId(A);spaceTabChannel.notifyLocal("guest",space);});
  await act(async()=>{pending.resolve(policy);await pending.promise;});expect(mock.claimAlert).not.toHaveBeenCalled();expect(screen.queryByTestId("focus-alert-message")).toBeNull();
});
it("a custom claim edited before presentation is consumed without showing a stale message",async()=>{
  await customMount();mock.currentCustomAlert.mockResolvedValue(false);await tickCustom();await waitFor(()=>expect(mock.currentCustomAlert).toHaveBeenCalled());expect(screen.queryByTestId("focus-alert-message")).toBeNull();
});
it("a changed master policy fences an already pending permissive response",async()=>{
  await customMount();const pending=deferred<typeof policy>();mock.settings.mockReturnValueOnce(pending.promise).mockResolvedValue({settings:{...defaultSettings(),all_disabled:true},preferences:[]});await tickCustom();await waitFor(()=>expect(mock.settings).toHaveBeenCalled());
  await act(async()=>{fireEvent(window,new Event("ayra:notifications-changed"));pending.resolve(policy);await pending.promise;});
  await waitFor(()=>expect(screen.getByText(en.market.focus.alerts.paused)).toBeTruthy());expect(mock.claimAlert).not.toHaveBeenCalled();
});
it.each(["expiry","delete","edit","pause","hide"])("does not reveal a queued custom cue after %s; the legacy completion remains visible",async reason=>{
  await customMount();const snapshot=await mock.exportSpace(),entry=snapshot.entries[0];
  entry.checklist.items=entry.checklist.items.map((item:{checked:boolean})=>({...item,checked:true}));entry.localAlerts={...alertsOf(entry),completion:true,completionEvent:{at:customDue,revision:1}};
  mock.claimAlert.mockImplementation(async(_space:string,_id:string,alert:{kind:string;token:number;custom?:Parameters<typeof recordCustomClaim>[1]})=>{
    if(alert.custom){if(entry.customSessionReceipts)return false;Object.assign(entry,recordCustomClaim(entry,alert.custom));return true;}
    if(alert.kind==="completion" && !entry.localAlerts.seenCompletion){entry.localAlerts.seenCompletion=alert.token;return true;}return false;
  });
  await tickCustom();await waitFor(()=>expect(mock.currentCustomAlert).toHaveBeenCalled());expect(screen.getByTestId("focus-alert-message").textContent).toContain(en.market.focus.alerts.completion);
  if(reason==="expiry")vi.setSystemTime(customDue+60001);
  if(reason==="delete")snapshot.preferences.customCatalog.items[0].deleted=true;
  if(reason==="edit")snapshot.preferences.customCatalog.items[0].revision++;
  if(reason==="pause"){mock.settings.mockResolvedValue({settings:{...defaultSettings(),all_disabled:true},preferences:[]});await act(async()=>{fireEvent(window,new Event("ayra:notifications-changed"));});}
  if(reason==="hide"){vi.spyOn(document,"hidden","get").mockReturnValue(true);await act(async()=>{fireEvent(document,new Event("visibilitychange"));});vi.spyOn(document,"hidden","get").mockReturnValue(false);await act(async()=>{fireEvent(document,new Event("visibilitychange"));});}
  await act(async()=>{fireEvent.focus(window);});expect(screen.getByTestId("focus-alert-message").textContent).toContain(en.market.focus.alerts.completion);fireEvent.click(screen.getByRole("button",{name:en.market.focus.alerts.dismiss}));
  expect(screen.queryByTestId("focus-alert-message")).toBeNull();
});
