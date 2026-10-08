import { describe, it, expect } from "vitest";
import { Trade, Strategy, Account } from "./types";
import {
  calculateProcessScore,
  getProcessScoreCategory,
  calculateMistakesPenalty,
} from "./process-score";

describe("Process Score Engine", () => {
  const dummyTrade: Trade = {
    id: "tr_1",
    accountId: "acc_1",
    instrument: "EURUSD",
    direction: "long",
    status: "closed",
    openedAt: "2026-03-01T10:00:00.000Z",
    result: "win",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    schemaVersion: 2,
  };

  const dummyStrategy: Strategy = {
    id: "strat_1",
    name: "SMC Core",
    color: "#50348f",
    version: 1,
    createdAt: "2026-03-01T10:00:00.000Z",
    rules: [
      { id: "r1", group: "entry", text: "Sweep HTF Liquidity", weight: "required" },
      { id: "r2", group: "entry", text: "MSS on 5M", weight: "required" },
      { id: "r3", group: "risk", text: "Check FVG entry", weight: "optional" },
    ],
    tags: ["SMC", "Sweep"],
    riskLimit: { type: "r", value: 1.0 },
    allowedSessions: ["london", "newyork"],
  };

  it("returns null score when no base components are available", () => {
    const tradeWithoutRules: Trade = { ...dummyTrade, ruleChecks: {} };
    // Strategy without rules, riskLimit, or allowedSessions
    const emptyStrategy: Strategy = {
      id: "strat_empty",
      name: "Empty",
      color: "#000",
      version: 1,
      createdAt: "2026-03-01T10:00:00.000Z",
      rules: [],
      tags: [],
    };

    const res = calculateProcessScore(tradeWithoutRules, emptyStrategy);
    expect(res.score).toBeNull();
    expect(res.snapshot.components).toHaveLength(0);
  });

  it("returns null score even if mistakes are present when no base components available", () => {
    const tradeWithMistake: Trade = { ...dummyTrade, mistakes: ["early_entry"] };
    const res = calculateProcessScore(tradeWithMistake, null);
    expect(res.score).toBeNull();
    expect(res.snapshot.mistakesPenalty).toBe(15);
  });

  it("calculates 100 score for full compliance with no mistakes", () => {
    const perfectTrade: Trade = {
      ...dummyTrade,
      session: "london",
      stopLoss: 1.085,
      ruleChecks: {
        r1: "passed",
        r2: "passed",
        r3: "passed",
      },
    };

    const res = calculateProcessScore(perfectTrade, dummyStrategy);
    expect(res.score).toBe(100);
    expect(res.snapshot.components).toHaveLength(3);
  });

  it("weighs required rules twice as much as optional rules", () => {
    // r1 (req, weight 2): failed
    // r2 (req, weight 2): passed
    // r3 (opt, weight 1): passed
    // Passed weight = 2 + 1 = 3 out of 5 total weight => 60% rules score
    const trade: Trade = {
      ...dummyTrade,
      ruleChecks: {
        r1: "failed",
        r2: "passed",
        r3: "passed",
      },
    };

    // Strategy with only rules (no risk limit or sessions)
    const rulesOnlyStrategy: Strategy = { ...dummyStrategy, riskLimit: null, allowedSessions: [] };

    const res = calculateProcessScore(trade, rulesOnlyStrategy);
    expect(res.score).toBe(60);
  });

  it("renormalizes weights when some components are unavailable", () => {
    // Only rules and session available (no risk limit)
    const trade: Trade = {
      ...dummyTrade,
      session: "london", // 100% session score
      ruleChecks: {
        r1: "passed",
        r2: "passed",
        r3: "failed", // r1(2)+r2(2)=4 out of 5 passed => 80% rules score
      },
    };

    const stratWithoutRisk: Strategy = { ...dummyStrategy, riskLimit: null };

    // Available: rules (base 50) and session (base 25). Total base = 75.
    // Normalized weights: rules = 50/75 = 66.67%, session = 25/75 = 33.33%.
    // Raw score = 0.8 * 66.67 + 1.0 * 33.33 = 53.33 + 33.33 = 86.67 => 87
    const res = calculateProcessScore(trade, stratWithoutRisk);
    expect(res.score).toBe(87);
  });

  it("calculates mistake penalties correctly and caps at 30 points", () => {
    expect(calculateMistakesPenalty({ ...dummyTrade, mistakes: [] })).toBe(0);
    expect(calculateMistakesPenalty({ ...dummyTrade, mistakes: ["early_entry"] })).toBe(15);
    expect(calculateMistakesPenalty({ ...dummyTrade, mistakes: ["early_entry", "fomo"] })).toBe(30);
    // 3 mistakes still capped at 30
    expect(calculateMistakesPenalty({ ...dummyTrade, mistakes: ["early_entry", "fomo", "no_stop"] })).toBe(30);
    // mistake "other" is ignored
    expect(calculateMistakesPenalty({ ...dummyTrade, mistakes: ["other"] })).toBe(0);
  });

  it("score is independent of trade outcome (win vs loss)", () => {
    const perfectTradeWin: Trade = {
      ...dummyTrade,
      result: "win",
      session: "london",
      stopLoss: 1.085,
      ruleChecks: { r1: "passed", r2: "passed", r3: "passed" },
    };

    const perfectTradeLoss: Trade = {
      ...dummyTrade,
      result: "loss",
      session: "london",
      stopLoss: 1.085,
      ruleChecks: { r1: "passed", r2: "passed", r3: "passed" },
    };

    const winRes = calculateProcessScore(perfectTradeWin, dummyStrategy);
    const lossRes = calculateProcessScore(perfectTradeLoss, dummyStrategy);

    expect(winRes.score).toBe(100);
    expect(lossRes.score).toBe(100);
  });

  it("categorizes process scores correctly", () => {
    expect(getProcessScoreCategory(85)).toBe("good");
    expect(getProcessScoreCategory(80)).toBe("good");
    expect(getProcessScoreCategory(79)).toBe("medium");
    expect(getProcessScoreCategory(50)).toBe("medium");
    expect(getProcessScoreCategory(49)).toBe("bad");
    expect(getProcessScoreCategory(0)).toBe("bad");
    expect(getProcessScoreCategory(null)).toBe("none");
  });
});
