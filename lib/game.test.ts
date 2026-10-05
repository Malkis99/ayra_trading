import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  xpForNextLevel,
  completeQuest,
  claimDailyReward,
  checkAndApplyDateResets,
  changePlan,
  getCharacterStatus,
  passQuest,
  replaceQuest,
  toggleRestDay,
  migrateState,
} from "./game";
import { getDeterministicDailyQuests } from "./quests";

describe("Game State Logic v3.1 (lib/game.ts & lib/quests.ts)", () => {
  it("deterministic daily quest selection works", () => {
    const q1 = getDeterministicDailyQuests("2026-10-05");
    const q2 = getDeterministicDailyQuests("2026-10-05");
    const q3 = getDeterministicDailyQuests("2026-10-06");

    expect(q1.core.length).toBe(3);
    expect(q1.bonus.length).toBe(2);
    expect(q1.core[0].id).toBe(q2.core[0].id);
    expect(q1.core[0].id).not.toBe(q3.core[0].id);
  });

  it("handles quest completion, level-up, typed chronicle, and history", () => {
    let state = { ...INITIAL_GAME_STATE };
    const date = new Date("2026-10-05T10:00:00Z");

    const res = completeQuest(state, "q_bias", "Daily Bias", "Trading", 40, 10, date);
    expect(res.state.xp).toBe(40);
    expect(res.state.coins).toBe(10);
    expect(res.state.completedQuestsToday["q_bias"]).toBe(true);
    expect(res.state.history.length).toBe(1);
    expect(res.state.history[0].questId).toBe("q_bias");
    expect(res.state.chronicle[0]).toEqual({
      type: "questDone",
      title: "Daily Bias",
      xp: 40,
    });
  });

  it("streak shield protects streak on missed active day", () => {
    let state = {
      ...INITIAL_GAME_STATE,
      currentStreak: 5,
      bestStreak: 5,
      streakShieldsAvailable: 1,
      lastWeeklyResetDate: "2026-10-05",
      lastQuestDate: "2026-10-05",
      completedQuestsToday: {}, // No quests completed on Oct 5
    };

    const day2 = new Date("2026-10-06T10:00:00Z");
    const resetted = checkAndApplyDateResets(state, day2);

    expect(resetted.currentStreak).toBe(5); // Saved by shield!
    expect(resetted.streakShieldsAvailable).toBe(0);

    // Next missed day without shield -> resets streak
    const day3 = new Date("2026-10-07T10:00:00Z");
    const resetted2 = checkAndApplyDateResets(resetted, day3);

    expect(resetted2.currentStreak).toBe(0);
    expect(resetted2.bestStreak).toBe(5);
  });

  it("rest day preserves streak without consuming shield", () => {
    let state = {
      ...INITIAL_GAME_STATE,
      currentStreak: 3,
      bestStreak: 3,
      streakShieldsAvailable: 1,
      lastWeeklyResetDate: "2026-10-05",
      isRestDay: true,
      lastQuestDate: "2026-10-05",
    };

    const day2 = new Date("2026-10-06T10:00:00Z");
    const resetted = checkAndApplyDateResets(state, day2);

    expect(resetted.currentStreak).toBe(4);
    expect(resetted.streakShieldsAvailable).toBe(1); // Shield was preserved!
  });

  it("quest replacement limit (2 max per day)", () => {
    let state = { ...INITIAL_GAME_STATE };
    const date = new Date("2026-10-05T10:00:00Z");

    const r1 = replaceQuest(state, "q_1", date);
    expect(r1.success).toBe(true);
    expect(r1.state.replacementsUsedToday).toBe(1);

    const r2 = replaceQuest(r1.state, "q_2", date);
    expect(r2.success).toBe(true);
    expect(r2.state.replacementsUsedToday).toBe(2);

    const r3 = replaceQuest(r2.state, "q_3", date);
    expect(r3.success).toBe(false);
    expect(r3.state.replacementsUsedToday).toBe(2);
  });

  it("pass quest does not cause penalties", () => {
    let state = { ...INITIAL_GAME_STATE };
    const date = new Date("2026-10-05T10:00:00Z");

    const passed = passQuest(state, "q_bias", date);
    expect(passed.passedQuestsToday["q_bias"]).toBe(true);
    expect(passed.xp).toBe(0);
    expect(passed.coins).toBe(0);
  });

  it("migrates legacy string chronicle entries gracefully", () => {
    const rawLegacy = {
      name: "OldTrader",
      chronicle: ["Персонаж создан", "Квест: Daily Bias (+40 XP)"],
    };

    const migrated = migrateState(rawLegacy);
    expect(migrated.name).toBe("OldTrader");
    expect(migrated.chronicle[0]).toEqual({
      type: "legacy",
      text: "Персонаж создан",
    });
  });
});
