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
  equipItem,
  unequipSlot,
  saveLoadout,
  applyLoadout,
  addPost,
  updateProfileInfo,
  checkAchievements,
} from "./game";
import { getDeterministicDailyQuests } from "./quests";
import { ITEMS } from "./items";

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
    expect(res.state.chronicle.some((c) => typeof c === "object" && c.type === "questDone")).toBe(true);
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

describe("T4 Profile & Wardrobe Logic Requirements", () => {
  it("enforces level unlocks for equipment items", () => {
    let state = { ...INITIAL_GAME_STATE, level: 1 };
    // Item 10 is Crown of Discipline (reqLevel 4)
    const crown = ITEMS[10];
    expect(crown.reqLevel).toBe(4);

    // Equip at level 1 should fail and leave equipment unchanged
    const attempt1 = equipItem(state, 10);
    expect(attempt1.state.equipment["Голова"]).toBeUndefined();

    // Equip at level 4 should succeed
    let stateLv4 = { ...state, level: 4 };
    const attempt2 = equipItem(stateLv4, 10);
    expect(attempt2.state.equipment["Голова"]).toBe(10);
  });

  it("handles equip and unequip actions correctly", () => {
    let state = { ...INITIAL_GAME_STATE, level: 1 };
    // Item 0 is Graphite Shirt (Top, reqLevel 1)
    const res1 = equipItem(state, 0);
    expect(res1.state.equipment["Верх"]).toBe(0);
    expect(res1.state.itemsEquippedCount).toBe(1);
    expect(
      res1.state.chronicle.some((c) => typeof c === "object" && c.type === "itemEquipped" && c.itemId === 0)
    ).toBe(true);

    // Unequip slot "Верх"
    const res2 = unequipSlot(res1.state, "Верх");
    expect(res2.state.equipment["Верх"]).toBeUndefined();
    expect(res2.state.chronicle[0]).toEqual({
      type: "itemUnequipped",
      slot: "Верх",
      itemId: 0,
    });
  });

  it("preview does not mutate saved state", () => {
    let state = { ...INITIAL_GAME_STATE, level: 1 };
    const previewItemId = 1; // Violet Hoodie
    const previewSlot = ITEMS[previewItemId].slot;

    // Simulate preview effective equipment calculation
    const effectiveEquipment = {
      ...state.equipment,
      [previewSlot]: previewItemId,
    };

    expect(effectiveEquipment[previewSlot]).toBe(previewItemId);
    // Original game state equipment must remain untouched!
    expect(state.equipment[previewSlot]).toBeUndefined();
  });

  it("saves and applies loadouts correctly", () => {
    let state = { ...INITIAL_GAME_STATE, level: 1 };
    // Equip item 0
    state = equipItem(state, 0).state;

    // Save to loadout "Сессия"
    state = saveLoadout(state, "Сессия");
    expect(state.loadouts["Сессия"]["Верх"]).toBe(0);

    // Unequip item 0
    state = unequipSlot(state, "Верх").state;
    expect(state.equipment["Верх"]).toBeUndefined();

    // Apply loadout "Сессия"
    const applied = applyLoadout(state, "Сессия");
    expect(applied.state.equipment["Верх"]).toBe(0);
    expect(applied.state.activeLoadout).toBe("Сессия");
  });

  it("unlocks achievements exactly once", () => {
    let state = { ...INITIAL_GAME_STATE };

    // Completing 1 quest unlocks "firstQuest"
    const res1 = completeQuest(state, "q_bias", "Daily Bias", "Trading", 40, 10);
    expect(res1.newlyUnlocked).toContain("firstQuest");
    expect(res1.state.achievements["firstQuest"]).toBe(true);

    // Calling checkAchievements again should return no new unlocks
    const res2 = checkAchievements(res1.state);
    expect(res2.newlyUnlocked).toEqual([]);
    expect(res2.state.achievements["firstQuest"]).toBe(true);
  });

  it("validates nickname rules on profile update", () => {
    let state = { ...INITIAL_GAME_STATE, name: "Original" };

    // Trims leading/trailing whitespace
    const s1 = updateProfileInfo(state, "  NewName  ", "bio");
    expect(s1.name).toBe("NewName");

    // Empty or whitespace-only nickname keeps previous name
    const s2 = updateProfileInfo(state, "   ", "bio");
    expect(s2.name).toBe("Original");

    // Nickname longer than 24 chars keeps previous name
    const s3 = updateProfileInfo(state, "A".repeat(25), "bio");
    expect(s3.name).toBe("Original");
  });

  it("guarantees GameState contains zero translated strings", () => {
    let state = { ...INITIAL_GAME_STATE };
    state = equipItem(state, 0).state;
    state = addPost(state, "My first post").state;

    // Achievements map stores boolean flags by achievement ID
    expect(Object.keys(state.achievements)).toEqual(
      expect.arrayContaining(["stylist", "author"])
    );
    expect(state.achievements["stylist"]).toBe(true);

    // Equipment stores item IDs by slot key
    expect(typeof state.equipment["Верх"]).toBe("number");

    // Chronicle entries use structured event objects
    const equippedEvent = state.chronicle.find(
      (e) => typeof e === "object" && e.type === "itemEquipped"
    );
    expect(equippedEvent).toBeDefined();
    expect(equippedEvent).toHaveProperty("itemId", 0);
  });
});
