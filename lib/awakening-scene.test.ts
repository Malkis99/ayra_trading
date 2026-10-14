import { describe, it, expect } from "vitest";
import { deriveScene, progressOf, sceneKey } from "./awakening-scene";

describe("awakening scene", () => {
  it("progress grows through steps 1–4 and is complete at the finale", () => {
    expect(progressOf(1, 0, 4)).toBe(0);
    expect(progressOf(2, 0, 8)).toBeCloseTo(0.25);
    expect(progressOf(3, 4, 8)).toBeCloseTo(0.625);
    expect(progressOf(5, 0, 1)).toBe(1);
  });

  it("the character wakes up with progress, never below a visible minimum", () => {
    expect(deriveScene({}, 0).awaken).toBe(0.35);
    expect(deriveScene({}, 1).awaken).toBe(1);
  });

  it("answers change the scene: markets → symbols, goal/problem → aura tone, experience → intensity, style → pace", () => {
    const s = deriveScene({ markets: ["crypto", "forex", "metals", "stocks", "energy"], mainProblem: "emotions", experience: "more_than_5", tradingStyle: "scalping" }, 0.5);
    expect(s.symbols).toEqual(["crypto", "fx", "metal", "stock"]);
    expect(s.tone).toBe("teal");
    expect(s.intensity).toBe(1);
    expect(s.pace).toBe("fast");
    expect(deriveScene({ mainProblem: "emotions", tradingGoal: ["market_understanding"] }, 0).tone).toBe("blue");
  });

  it("scene key changes only on visible changes", () => {
    const a = deriveScene({ markets: ["crypto"] }, 0.2);
    const b = deriveScene({ markets: ["crypto"], hobbies: ["chess"] }, 0.4);
    expect(sceneKey(a)).toBe(sceneKey(b));
    expect(sceneKey(deriveScene({ markets: ["forex"] }, 0.2))).not.toBe(sceneKey(a));
  });
});
