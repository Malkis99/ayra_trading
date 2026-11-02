import { describe, expect, it } from "vitest";
import {
  clipToWindow,
  DRAWING_BAR_W,
  framesMatch,
  intervalTag,
  LEGEND_H,
  legendCovers,
  looksBlank,
  PRICE_SCALE_W,
  SHOT_CARD_W,
  SHOT_GAP,
  SHOT_HEADER,
  SHOT_PAD,
  shotFileName,
  shotLayout,
} from "./chart-shot";

const rgba = (pixels: [number, number, number][]) => pixels.flatMap(([r, g, b]) => [r, g, b, 255]);

describe("chart screenshot", () => {
  it("lays out our line on top, the chart, and the card on its right", () => {
    const grid = { x: 300, y: 200, w: 900, h: 600 };
    const withCard = shotLayout(grid, 250);
    expect(withCard.chart).toEqual({ x: SHOT_PAD, y: SHOT_PAD + SHOT_HEADER, w: 900, h: 600 });
    expect(withCard.card).toEqual({ x: SHOT_PAD + 900 + SHOT_GAP, y: SHOT_PAD + SHOT_HEADER, w: SHOT_CARD_W, h: 250 });
    expect(withCard.width).toBe(SHOT_PAD * 2 + 900 + SHOT_GAP + SHOT_CARD_W);
    expect(withCard.height).toBe(SHOT_PAD + SHOT_HEADER + 600 + SHOT_PAD);
    // the card hidden: only the chart
    const alone = shotLayout(grid, null);
    expect(alone.card).toBeNull();
    expect(alone.width).toBe(SHOT_PAD * 2 + 900);
    // a card taller than the chart sets the height
    expect(shotLayout({ ...grid, h: 100 }, 300).height).toBe(SHOT_PAD + SHOT_HEADER + 300 + SHOT_PAD);
  });

  it("16–17: covers each window's legend line, keeps the price scale and the drawing toolbar", () => {
    const grid = { x: 100, y: 50, w: 800, h: 600 };
    const widgets = [
      { x: 100, y: 82, w: 396, h: 268 },
      { x: 504, y: 82, w: 396, h: 268 },
    ];
    expect(legendCovers(grid, widgets, false)).toEqual([
      { x: 0, y: 32, w: 396 - PRICE_SCALE_W, h: LEGEND_H },
      { x: 404, y: 32, w: 396 - PRICE_SCALE_W, h: LEGEND_H },
    ]);
    expect(legendCovers(grid, widgets.slice(0, 1), true)).toEqual([{ x: DRAWING_BAR_W, y: 32, w: 396 - PRICE_SCALE_W - DRAWING_BAR_W, h: LEGEND_H }]);
  });

  it("keeps only the part inside the window", () => {
    expect(clipToWindow({ x: 10, y: 600, w: 500, h: 500 }, 1440, 900)).toEqual({ x: 10, y: 600, w: 500, h: 300 });
    expect(clipToWindow({ x: -20, y: -10, w: 100, h: 100 }, 1440, 900)).toEqual({ x: 0, y: 0, w: 80, h: 90 });
  });

  it("tells this tab's picture from another window's or the screen's", () => {
    expect(framesMatch(1440, 900, 1440, 900)).toBe(true);
    expect(framesMatch(2880, 1800, 1440, 900)).toBe(true);
    expect(framesMatch(1920, 1080, 1440, 900)).toBe(false);
    expect(framesMatch(0, 0, 1440, 900)).toBe(false);
  });

  it("notices an empty chart (one colour) and a real one", () => {
    expect(looksBlank(rgba(Array.from({ length: 5000 }, () => [24, 23, 31])), 1)).toBe(true);
    expect(looksBlank([])).toBe(true);
    const chart = Array.from({ length: 5000 }, (_, i): [number, number, number] => (i % 7 === 0 ? [52, 211, 153] : i % 11 === 0 ? [251, 113, 133] : [24, 23, 31]));
    expect(looksBlank(rgba(chart), 1)).toBe(false);
    // a thin line on a big empty chart (0.5% of the pixels) is still a chart
    const line = Array.from({ length: 20000 }, (_, i): [number, number, number] => (i % 200 === 0 ? [163, 138, 209] : [24, 23, 31]));
    expect(looksBlank(rgba(line))).toBe(false);
  });

  it("names the file by the instrument, timeframe and local time", () => {
    expect(shotFileName("EURUSD", "1h", new Date(2026, 10, 2, 9, 5))).toBe("AYRA_EURUSD_1h_2026-11-02_09-05.png");
    expect(shotFileName("BTC/USD", "15m", new Date(2026, 0, 1, 0, 0))).toBe("AYRA_BTCUSD_15m_2026-01-01_00-00.png");
    expect(["1", "15", "60", "240", "D", "W", "M"].map(intervalTag)).toEqual(["1m", "15m", "1h", "4h", "1D", "1W", "1M"]);
  });
});
