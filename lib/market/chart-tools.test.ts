import { describe, expect, it } from "vitest";
import { CHART_STYLES, INDICATORS, MAX_INDICATORS, normalizeIndicators, studiesOf, toggleIndicator } from "./chart-tools";
import { normalizeChartPrefs } from "./watchlist";

describe("«Chart type» and «Indicators»", () => {
  it("candles by default, no indicators; stored values kept, wrong ones dropped", () => {
    expect(normalizeChartPrefs(null)).toMatchObject({ style: "1", indicators: [] });
    expect(normalizeChartPrefs({ style: "8", indicators: ["rsi", "macd", "nope", "rsi"] })).toMatchObject({ style: "8", indicators: ["rsi", "macd"] });
    expect(normalizeChartPrefs({ style: "4" }).style).toBe("1");
  });

  it("no «Technical ratings» anywhere; every chart type and indicator is listed once", () => {
    expect(INDICATORS.some((i) => /technical|rating/i.test(i.study))).toBe(false);
    expect(new Set(INDICATORS.map((i) => i.id)).size).toBe(INDICATORS.length);
    expect(new Set(CHART_STYLES).size).toBe(CHART_STYLES.length);
  });

  it(`at most ${MAX_INDICATORS} at once; toggling adds and removes`, () => {
    let list = toggleIndicator([], "rsi");
    list = toggleIndicator(list, "macd");
    expect(list).toEqual(["rsi", "macd"]);
    expect(toggleIndicator(list, "rsi")).toEqual(["macd"]);
    const full = normalizeIndicators(["sma", "ema", "bb", "vwap", "rsi", "macd", "atr"]);
    expect(full).toHaveLength(MAX_INDICATORS);
    expect(toggleIndicator(full, "cci")).toEqual(full);
    expect(studiesOf(["rsi", "bb"])).toEqual(["STD;RSI", "STD;Bollinger_Bands"]);
  });
});
