import { afterEach, describe, expect, it, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMarketEvents } from "./use-market-events";

const query = vi.hoisted(() => ({ limit:vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => ({ from:(table:string) => {
  if (table !== "market_events") throw new Error("unexpected table");
  const chain = { select:() => chain,gte:() => chain,lt:() => chain,order:() => chain,limit:query.limit };
  return chain;
} }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("calendar return refresh without polling or upstream APIs", () => {
  it("refreshes once on mount and once per leave/return, not on minor rerenders or duplicate focus events", async () => {
    query.limit.mockResolvedValue({ data:[],error:null });
    const { result,rerender } = renderHook(() => useMarketEvents(1000,2000));
    await waitFor(()=>expect(result.current[0].status).toBe("ready"));
    expect(query.limit).toHaveBeenCalledTimes(1);
    rerender(); act(()=>window.dispatchEvent(new Event("focus")));
    expect(query.limit).toHaveBeenCalledTimes(1);
    act(()=>{ window.dispatchEvent(new Event("blur"));window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus")); });
    await waitFor(()=>expect(query.limit).toHaveBeenCalledTimes(2));
  });
  it("returning to a remounted calendar re-reads the database despite cached content", async () => {
    query.limit.mockResolvedValue({ data:[],error:null });
    const first=renderHook(()=>useMarketEvents(3000,4000)); await waitFor(()=>expect(first.result.current[0].status).toBe("ready"));first.unmount();
    const second=renderHook(()=>useMarketEvents(3000,4000));await waitFor(()=>expect(second.result.current[0].status).toBe("ready"));
    expect(query.limit).toHaveBeenCalledTimes(2);
  });
  it("does not update a discarded hook when an old response completes", async () => {
    let finish:(r:{data:never[];error:null})=>void=()=>{};
    query.limit.mockImplementationOnce(()=>new Promise((resolve)=>{finish=resolve;}));
    const first=renderHook(()=>useMarketEvents(5000,6000));first.unmount();
    await act(async()=>finish({data:[],error:null}));
    query.limit.mockResolvedValue({data:[],error:null});
    const second=renderHook(()=>useMarketEvents(5000,6000));await waitFor(()=>expect(second.result.current[0].status).toBe("ready"));
    expect(query.limit).toHaveBeenCalledTimes(2);
  });
});
test("refreshes an open calendar once a minute until the result arrives", async () => {
  vi.useFakeTimers();
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const start = Date.parse("2026-11-10T13:30:00Z");
  vi.setSystemTime(start);
  const waiting = { id: "cpi", starts_at: new Date(start).toISOString(), kind: "release", importance: 3, status: "scheduled", actual: null };
  const published = { ...waiting, status: "released", actual: "+0.4%" };
  query.limit.mockResolvedValueOnce({ data: [waiting], error: null }).mockResolvedValue({ data: [published], error: null });
  try {
    const { result } = renderHook(() => useMarketEvents(start - 1000, start + 1000, true));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(query.limit).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current[0]).toMatchObject({ status: "ready", events: [published] });
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(query.limit).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    focused.mockRestore();
    vi.useRealTimers();
  }
});

test("pauses on blur and stops at the end of the release window", async () => {
  vi.useFakeTimers();
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const start = Date.parse("2026-11-11T13:30:00Z");
  vi.setSystemTime(start + 18 * 60_000);
  const pending = { id: "nfp", starts_at: new Date(start).toISOString(), kind: "release", importance: 3, status: "scheduled" };
  query.limit.mockResolvedValue({ data: [pending], error: null });
  try {
    renderHook(() => useMarketEvents(start - 1000, start + 1000, true));
    await act(async () => {});
    act(() => window.dispatchEvent(new Event("blur")));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(query.limit).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(query.limit).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(query.limit).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    focused.mockRestore();
    vi.useRealTimers();
  }
});
