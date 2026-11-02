import { describe, expect, it } from "vitest";
import { DEFAULT_PANES, effectiveLayout, normalizePanes, paneInstrument, withPane } from "./chart-layout";
import { normalizeChartPrefs } from "./watchlist";

describe("layouts 1 / 2 / 4", () => {
  it("one chart, «One instrument in all windows» off, windows 2–4 on 4 h, 1 D, 15 min by default", () => {
    expect(normalizeChartPrefs(null)).toMatchObject({ layout: 1, link: false, panes: DEFAULT_PANES });
    expect(normalizeChartPrefs({ layout: 3, link: "yes" })).toMatchObject({ layout: 1, link: false });
    expect(normalizeChartPrefs({ layout: 4, link: true }).layout).toBe(4);
    expect(normalizePanes([{ instrument: "gold", interval: "5" }, { instrument: "nope", interval: "x" }])).toEqual([
      { instrument: "gold", interval: "5" },
      { instrument: null, interval: "D" },
      { instrument: null, interval: "15" },
    ]);
  });

  it("phones show at most two windows", () => {
    expect(effectiveLayout(4, true)).toBe(2);
    expect(effectiveLayout(2, true)).toBe(2);
    expect(effectiveLayout(4, false)).toBe(4);
  });

  it("the instrument of a window: its own, the main one until picked, or the main one everywhere when linked", () => {
    const panes = withPane(DEFAULT_PANES, 1, { instrument: "gold" });
    expect(paneInstrument(0, "eurusd", panes, false)).toBe("eurusd");
    expect(paneInstrument(1, "eurusd", panes, false)).toBe("gold");
    expect(paneInstrument(2, "eurusd", panes, false)).toBe("eurusd");
    expect(paneInstrument(1, "eurusd", panes, true)).toBe("eurusd");
    expect(withPane(panes, 3, { interval: "60" })[2]).toEqual({ instrument: null, interval: "60" });
  });
});
