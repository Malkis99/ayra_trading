import { describe, it, expect } from "vitest";
import { clampScale, fitScale, isFit, scrollToKeep, toggledScale, ZOOM_MAX } from "./zoom";

describe("screenshot viewer scale", () => {
  const laptop = { w: 1100, h: 640 }; // picture area of the viewer at 1440×900

  it("fits the whole picture of any format; never above the real size", () => {
    expect(fitScale({ w: 739, h: 1600 }, laptop)).toBeCloseTo(0.4); // tall phone screenshot: the height decides
    expect(fitScale({ w: 1600, h: 900 }, laptop)).toBeCloseTo(0.6875); // wide: the width decides
    expect(fitScale({ w: 1000, h: 1000 }, laptop)).toBeCloseTo(0.64); // square
    expect(fitScale({ w: 300, h: 200 }, laptop)).toBe(1); // small: real size
    const s = fitScale({ w: 739, h: 1600 }, laptop);
    expect(739 * s).toBeLessThanOrEqual(laptop.w);
    expect(1600 * s).toBeLessThanOrEqual(laptop.h);
  });

  it("double click: fit ↔ 100%; a small picture goes to 200%", () => {
    expect(toggledScale(0.4, 0.4)).toBe(1);
    expect(toggledScale(1, 0.4)).toBe(0.4);
    expect(toggledScale(1.5, 0.4)).toBe(0.4);
    expect(toggledScale(1, 1)).toBe(2);
  });

  it("zoom stays between «fit» and 400%", () => {
    expect(clampScale(0.1, 0.4)).toBe(0.4);
    expect(clampScale(9, 0.4)).toBe(ZOOM_MAX);
    expect(clampScale(0.5, 1)).toBe(1);
    expect(isFit(0.401, 0.4)).toBe(true);
  });

  it("keeps the same point of the picture under the cursor / centre when zooming", () => {
    const win = { w: 400, h: 300 };
    const r = scrollToKeep({ scale: 1, scrollLeft: 100, scrollTop: 50 }, 2, win);
    // centre (200,150) + scroll (100,50) = picture point (300,200) at scale 1 → at scale 2 it is (600,400)
    expect(r).toEqual({ left: 400, top: 250 });
    expect(scrollToKeep({ scale: 1, scrollLeft: 0, scrollTop: 0 }, 0.5, win)).toEqual({ left: 0, top: 0 });
  });
});
