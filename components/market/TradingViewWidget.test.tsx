import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TRADINGVIEW_SCRIPT_BASE, TradingViewWidget, WIDGET_LOAD_TIMEOUT_MS, widgetConfig } from "./TradingViewWidget";
import { CATEGORIES, CORE_INSTRUMENTS } from "@/lib/market/instruments";

const texts = { loadingText: "loading", errorText: "TradingView is not responding", retryLabel: "Try again" };

function renderWidget() {
  return render(<TradingViewWidget widget="mini-symbol-overview" config={widgetConfig({ symbol: "FX:EURUSD" }, "ru", "https://ayra.test")} height={200} label="EURUSD" testId="w" {...texts} />);
}
const scriptOf = (container: HTMLElement) => container.querySelector("script") as HTMLScriptElement | null;

describe("widgetConfig", () => {
  it("dark, the app language, clicks lead back into the app, nothing partner-like", () => {
    const c = widgetConfig({ symbol: "FX:EURUSD" }, "en", "https://ayra.test");
    expect(c).toMatchObject({ symbol: "FX:EURUSD", colorTheme: "dark", locale: "en", isTransparent: true, largeChartUrl: "https://ayra.test/market" });
    expect(Object.keys(c).filter((k) => /refer|affil|partner|utm|campaign/i.test(k))).toEqual([]);
  });
});

describe("instruments", () => {
  it("the D-14 core in the Pack order and the five categories", () => {
    expect(CORE_INSTRUMENTS.map((i) => i.id)).toEqual(["dxy", "spx", "ndx", "gold", "oil", "btc"]);
    expect(CATEGORIES.map((c) => c.id)).toEqual(["forex", "indices", "crypto", "commodities", "bonds"]);
    for (const c of CATEGORIES) expect(c.symbols.length).toBeGreaterThan(0);
  });
  it("only symbols that the widgets show (checked 2026-11-01)", () => {
    const all = [...CORE_INSTRUMENTS.map((i) => i.symbol), ...CATEGORIES.flatMap((c) => c.symbols)];
    for (const blocked of ["TVC:DXY", "SP:SPX", "NASDAQ:NDX", "TVC:US10Y", "TVC:US02Y"]) expect(all).not.toContain(blocked);
  });
});

describe("TradingViewWidget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("inserts TradingView's embed script with the config (no IntersectionObserver in jsdom: loads at once)", () => {
    const { container } = renderWidget();
    const script = scriptOf(container);
    expect(script?.src).toBe(`${TRADINGVIEW_SCRIPT_BASE}mini-symbol-overview.js`);
    expect(JSON.parse(script?.textContent ?? "{}")).toMatchObject({ symbol: "FX:EURUSD", colorTheme: "dark", locale: "ru" });
    expect(screen.getByTestId("w").getAttribute("data-status")).toBe("loading");
    expect(screen.getByTestId("w-loading").textContent).toContain("loading");
  });

  it("ready once the widget's frame appears", async () => {
    const { container } = renderWidget();
    await act(async () => {
      container.querySelector(".tradingview-widget-container")!.appendChild(document.createElement("iframe"));
    });
    expect(screen.getByTestId("w").getAttribute("data-status")).toBe("ready");
    expect(screen.queryByTestId("w-loading")).toBeNull();
  });

  it("the script fails → a plain message and «Try again» loads it anew", () => {
    const { container } = renderWidget();
    act(() => {
      scriptOf(container)!.dispatchEvent(new Event("error"));
    });
    expect(screen.getByTestId("w-error").textContent).toContain("TradingView is not responding");
    fireEvent.click(screen.getByTestId("w-retry"));
    expect(screen.queryByTestId("w-error")).toBeNull();
    expect(container.querySelectorAll("script")).toHaveLength(1);
    expect(screen.getByTestId("w").getAttribute("data-status")).toBe("loading");
  });

  it("no frame for too long → the same message", () => {
    vi.useFakeTimers();
    renderWidget();
    act(() => {
      vi.advanceTimersByTime(WIDGET_LOAD_TIMEOUT_MS + 1);
    });
    expect(screen.getByTestId("w-error")).toBeTruthy();
  });

  it("waits until the box is near the screen", () => {
    let callback: IntersectionObserverCallback = () => {};
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe = observe;
        disconnect() {}
      }
    );
    try {
      const { container } = renderWidget();
      expect(scriptOf(container)).toBeNull();
      expect(screen.getByTestId("w").getAttribute("data-status")).toBe("idle");
      act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(scriptOf(container)).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
