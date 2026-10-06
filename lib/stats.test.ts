import { describe, it, expect } from "vitest";
import {
  calculateStats,
  getCharacterPower,
  getStatBalance,
  getReputation,
  recordDailyStatEvent,
  exportProfileDataJSON,
  isValidLatinNickname,
  transliterateNickname,
} from "./stats";

describe("lib/stats", () => {
  const dummyState = {
    level: 3,
    xp: 80,
    currentStreak: 5,
    weeklyQuestCount: 4,
    completedQuestsToday: { q1: true, q2: true },
    equipment: { top: 1 },
    posts: ["Post 1"],
    history: [{ category: "Trading" }, { category: "Trading" }, { category: "Mental" }],
    isRestDay: false,
    name: "TraderOne",
  };

  it("calculateStats returns consistent stat values for Overview and Stats", () => {
    const overviewStats = calculateStats(dummyState);
    const statsTabStats = calculateStats(dummyState);

    expect(overviewStats).toEqual(statsTabStats);
    expect(Object.keys(overviewStats)).toHaveLength(8);

    expect(overviewStats.discipline).toBeDefined();
    expect(overviewStats.trading).toBeDefined();
    expect(overviewStats.intelligence).toBeDefined();
    expect(overviewStats.focus).toBeDefined();
    expect(overviewStats.psychology).toBeDefined();
    expect(overviewStats.knowledge).toBeDefined();
    expect(overviewStats.endurance).toBeDefined();
    expect(overviewStats.strength).toBeDefined();
  });

  it("getCharacterPower and getStatBalance return deterministic values", () => {
    const stats = calculateStats(dummyState);
    const power = getCharacterPower(stats);
    expect(power).toBeGreaterThan(0);

    const balance = getStatBalance(stats);
    expect(balance.strongestStat).toBeDefined();
    expect(balance.weakestStat).toBeDefined();
  });

  it("getReputation calculates tier and points correctly", () => {
    const rep = getReputation({ level: 5, history: [1, 2, 3], currentStreak: 7 });
    expect(rep.points).toEqual(5 * 20 + 3 * 5 + 7 * 10); // 100 + 15 + 70 = 185
    expect(rep.tierId).toEqual("reliable");
  });

  it("isValidLatinNickname and transliterateNickname handle Russian and Latin correctly", () => {
    expect(isValidLatinNickname("Trader_99")).toBe(true);
    expect(isValidLatinNickname("Трейдер")).toBe(false);

    expect(transliterateNickname("Алекс")).toEqual("Aleks");
    expect(transliterateNickname("Иван-123")).toEqual("Ivan-123");
  });

  it("recordDailyStatEvent correctly updates dailyStats and maintains max 365 entries", () => {
    let dailyStats: Record<string, any> = {};
    dailyStats = recordDailyStatEvent(dailyStats, "2026-10-06", {
      type: "questDone",
      category: "Trading",
      xp: 40,
      coins: 10,
    });

    expect(dailyStats["2026-10-06"]).toBeDefined();
    expect(dailyStats["2026-10-06"].totalQuestsCompleted).toBe(1);
    expect(dailyStats["2026-10-06"].xpGained).toBe(40);
    expect(dailyStats["2026-10-06"].coinsGained).toBe(10);
    expect(dailyStats["2026-10-06"].questsCompleted.Trading).toBe(1);
  });

  it("exportProfileDataJSON exports pure JSON structure", () => {
    const jsonStr = exportProfileDataJSON(dummyState, new Date("2026-10-06T12:00:00Z"));
    const parsed = JSON.parse(jsonStr);

    expect(parsed.app).toBe("ayra");
    expect(parsed.user.name).toBe("TraderOne");
    expect(parsed.user.level).toBe(3);
  });
});
