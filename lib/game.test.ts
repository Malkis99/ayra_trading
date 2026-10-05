import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  xpForNextLevel,
  completeQuest,
  claimDailyReward,
  checkAndApplyDateResets,
  changePlan,
  getCharacterStatus,
  GameState,
} from "./game";

describe("Game State Logic (lib/game.ts)", () => {
  it("calculates level XP thresholds correctly", () => {
    expect(xpForNextLevel(1)).toBe(120); // 80 + 1 * 40
    expect(xpForNextLevel(2)).toBe(160); // 80 + 2 * 40
    expect(xpForNextLevel(3)).toBe(200); // 80 + 3 * 40
  });

  it("handles quest completion, level-up, and XP carryover", () => {
    let state = { ...INITIAL_GAME_STATE };
    const date = new Date("2026-10-05T10:00:00Z"); // Monday

    // Complete quest 1: +40 XP, +10 Coins
    let res = completeQuest(state, 0, "Daily Bias", date);
    expect(res.leveledUp).toBe(false);
    expect(res.state.xp).toBe(40);
    expect(res.state.coins).toBe(10);
    expect(res.state.level).toBe(1);
    expect(res.state.weeklyQuestCount).toBe(1);

    // Complete quest 2: +40 XP (total 80)
    res = completeQuest(res.state, 1, "Journal Trade", date);
    expect(res.state.xp).toBe(80);

    // Complete quest 3: +40 XP (total 120 -> Lv 1 requires 120 -> level up to Lv 2, 0 XP remaining)
    res = completeQuest(res.state, 2, "Reflection", date);
    expect(res.leveledUp).toBe(true);
    expect(res.newLevel).toBe(2);
    expect(res.state.level).toBe(2);
    expect(res.state.xp).toBe(0);
    expect(res.state.coins).toBe(30);
    expect(res.state.chronicle[0]).toContain("Level up! Lv 2");
  });

  it("ignores repeated completion of the same quest on the same day", () => {
    const state = { ...INITIAL_GAME_STATE };
    const date = new Date("2026-10-05T10:00:00Z");

    const res1 = completeQuest(state, 0, "Daily Bias", date);
    const res2 = completeQuest(res1.state, 0, "Daily Bias", date);

    expect(res2.state.xp).toBe(res1.state.xp);
    expect(res2.state.coins).toBe(res1.state.coins);
    expect(res2.state.weeklyQuestCount).toBe(res1.state.weeklyQuestCount);
  });

  it("resets daily quests on a new local date without resetting daily reward streak", () => {
    let state = { ...INITIAL_GAME_STATE };
    const day1 = new Date("2026-10-05T10:00:00Z");
    const day2 = new Date("2026-10-06T10:00:00Z");

    // Complete quest on Day 1
    const res1 = completeQuest(state, 0, "Daily Bias", day1);
    expect(res1.state.completedQuestsToday[0]).toBe(true);

    // Check reset on Day 2
    const resettedState = checkAndApplyDateResets(res1.state, day2);
    expect(resettedState.completedQuestsToday[0]).toBeUndefined();
    expect(resettedState.lastQuestDate).toBe("2026-10-06");
  });

  it("allows claiming daily reward only once per local day and advances 1-7 in sequence", () => {
    let state = { ...INITIAL_GAME_STATE };
    const day1 = new Date("2026-10-05T10:00:00Z");

    // Day 1 Claim (Day 1 reward = 10 Coins)
    let claim1 = claimDailyReward(state, day1);
    expect(claim1.claimedCoins).toBe(10);
    expect(claim1.state.coins).toBe(10);
    expect(claim1.state.dailyRewardIndex).toBe(1);

    // Second claim on Day 1 should yield 0
    let claim1Repeat = claimDailyReward(claim1.state, day1);
    expect(claim1Repeat.claimedCoins).toBe(0);
    expect(claim1Repeat.state.coins).toBe(10);

    // Day 3 Claim (missed Day 2): Day 2 reward = 10 Coins, index continues from 1 -> 2
    const day3 = new Date("2026-10-07T10:00:00Z");
    let claim3 = claimDailyReward(claim1.state, day3);
    expect(claim3.claimedCoins).toBe(10);
    expect(claim3.state.dailyRewardIndex).toBe(2);
    expect(claim3.state.coins).toBe(20);
  });

  it("resets weekly quest challenge count on Monday", () => {
    let state: GameState = {
      ...INITIAL_GAME_STATE,
      weeklyQuestCount: 8,
      lastWeeklyResetDate: "2026-09-28", // Previous Monday
    };

    const nextMonday = new Date("2026-10-05T10:00:00Z");
    const res = checkAndApplyDateResets(state, nextMonday);

    expect(res.weeklyQuestCount).toBe(0);
    expect(res.lastWeeklyResetDate).toBe("2026-10-05");
  });

  it("changes plan and updates chronicle", () => {
    let state = { ...INITIAL_GAME_STATE };
    state = changePlan(state, "Pro");

    expect(state.plan).toBe("Pro");
    expect(state.chronicle[0]).toBe("Тариф: Pro");
  });

  it("calculates character status dynamically", () => {
    expect(getCharacterStatus(0)).toBe("Resting");
    expect(getCharacterStatus(1)).toBe("Training");
    expect(getCharacterStatus(3)).toBe("Training");
  });
});
