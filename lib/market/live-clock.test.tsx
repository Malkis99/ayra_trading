import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClock } from "./live-clock";

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-06T08:30:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the Market clock", () => {
  it("ticks every second", () => {
    const { result, unmount } = renderHook(() => useClock("second"));
    expect(result.current).toBe(Date.parse("2026-04-06T08:30:00Z"));
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(Date.parse("2026-04-06T08:30:03Z"));
    unmount();
  });

  it("the minute clock changes only on a new minute (seconds do not re-render it)", () => {
    let renders = 0;
    const { result, unmount } = renderHook(() => {
      renders++;
      return useClock("minute");
    });
    const before = renders;
    act(() => vi.advanceTimersByTime(30_000));
    expect(renders).toBe(before);
    act(() => vi.advanceTimersByTime(31_000));
    expect(result.current).toBe(Date.parse("2026-04-06T08:31:00Z"));
    expect(renders).toBe(before + 1);
    unmount();
  });

  it("a background tab pauses the clock; on return the time is taken at once", () => {
    const { result, unmount } = renderHook(() => useClock("second"));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(10_000));
    // paused: still the time when the tab was hidden
    expect(result.current).toBe(Date.parse("2026-04-06T08:30:00Z"));
    expect(vi.getTimerCount()).toBe(0);
    act(() => setVisibility("visible"));
    expect(result.current).toBe(Date.parse("2026-04-06T08:30:10Z"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(Date.parse("2026-04-06T08:30:11Z"));
    unmount();
  });

  it("stops when nothing listens", () => {
    const { unmount } = renderHook(() => useClock("second"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
