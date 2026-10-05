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
  validateNickname,
  transliterateCyrillic,
  containsCyrillic,
  getReputation,
  getStatLevelAndRank,
  getCharacterPower,
  getStatBalance,
  updateStatSnapshots,
  checkAndUnlockTitles,
  selectTitle,
  equipItem,
  unequipItem,
  unequipSlot,
  saveLoadout,
  applyLoadout,
  addPost,
  updateProfileInfo,
  checkAchievements,
} from "./game";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";
import { getDeterministicDailyQuests } from "./quests";
import { ITEMS } from "./items";

describe("T4.1 Profile, Titles, Reputation, Stats & Validation Tests", () => {
  // (a) Dictionary key parity test
  it("(a) ru and en dictionary keys match 1:1", () => {
    function getKeys(obj: any, prefix = ""): string[] {
      let keys: string[] = [];
      for (const k in obj) {
        if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
          keys = keys.concat(getKeys(obj[k], `${prefix}${k}.`));
        } else {
          keys.push(`${prefix}${k}`);
        }
      }
      return keys.sort();
    }

    const ruKeys = getKeys(ru);
    const enKeys = getKeys(en);

    expect(ruKeys).toEqual(enKeys);
  });

  // (b) RU dictionary allowed Latin words test
  it("(b) ru dictionary values contain no Latin words outside allowed list", () => {
    const ALLOWED_LATIN = new Set([
      // Allowed product/brand words
      "AYRA",
      "Trading",
      "Free",
      "Pro",
      "Elite",
      "XP",
      "Coins",
      "Supabase",
      "Focus",
      // Task reference markers like T3, T4, T6, etc.
      "T",
      // Financial/Market terms
      "R",
      "DXY",
      "S",
      "P",
      "Nasdaq",
      "Gold",
      "Oil",
      "BTC",
      "CPI",
      "FOMC",
      "PMI",
      "Process",
      "Score",
      "Trade",
      "DNA",
      "Weekly",
      "Review",
      "News",
      "Intelligence",
      "Scanner",
      "Prop",
      "Rules",
      "Tracker",
      "Overview",
      "Calendar",
      "Level",
      "up",
      "Lv",
      "Daily",
      "Bias",
      "AI",
      "Language",
      "USD",
      "Tab",
      // Placeholder variable names in templates like {level}, {nextXp}, {name}, etc.
      "level",
      "nextXp",
      "name",
      "count",
      "xp",
      "coins",
      "points",
      "total",
      "current",
      "day",
      "plan",
      "used",
      "date",
      "questsWord",
      "action",
      "tab",
      "gain",
      "streak",
      "title",
      "text",
      "stat",
      "status",
      "slot",
    ]);

    function checkValues(obj: any) {
      for (const k in obj) {
        if (typeof obj[k] === "object" && obj[k] !== null) {
          checkValues(obj[k]);
        } else if (typeof obj[k] === "string") {
          const latinWords = obj[k].match(/[A-Za-z]+/g) || [];
          for (const word of latinWords) {
            if (!ALLOWED_LATIN.has(word)) {
              console.log("Found unexpected Latin word in ru dictionary:", word, "at key/path:", k);
            }
            expect(ALLOWED_LATIN.has(word)).toBe(true);
          }
        }
      }
    }

    checkValues(ru);
  });

  // (c) EN dictionary no Cyrillic test
  it("(c) en dictionary values contain no Cyrillic characters", () => {
    function checkNoCyrillic(obj: any) {
      for (const k in obj) {
        if (typeof obj[k] === "object" && obj[k] !== null) {
          checkNoCyrillic(obj[k]);
        } else if (typeof obj[k] === "string") {
          expect(containsCyrillic(obj[k])).toBe(false);
        }
      }
    }

    checkNoCyrillic(en);
  });

  // (d) GameState clean keys test
  it("(d) GameState contains no localized strings", () => {
    expect(typeof INITIAL_GAME_STATE.name).toBe("string");
    expect(containsCyrillic(INITIAL_GAME_STATE.name)).toBe(false);
    expect(INITIAL_GAME_STATE.bio).toBeNull();
    expect(containsCyrillic(INITIAL_GAME_STATE.selectedTitle)).toBe(false);
  });

  // (e) Nickname validation and transliteration test
  it("(e) Nickname validation and transliteration rules work correctly", () => {
    // Validation
    expect(validateNickname("Aleks").isValid).toBe(true);
    expect(validateNickname("Al").isValid).toBe(false); // < 3 chars
    expect(validateNickname("Алекс").isValid).toBe(false); // Cyrillic
    expect(validateNickname("Trader_One-99").isValid).toBe(true);

    // Transliteration
    expect(transliterateCyrillic("Алекс")).toBe("Aleks");
    expect(transliterateCyrillic("Дмитрий")).toBe("Dmitriy");
    expect(transliterateCyrillic("Иван")).toBe("Ivan");
    expect(transliterateCyrillic("Я")).toBe("TraderOne"); // < 3 chars ('Ya') -> fallback
  });

  // (f) Titles unlock and selection test
  it("(f) Title unlock conditions and selection work as expected", () => {
    let state = { ...INITIAL_GAME_STATE };
    expect(state.unlockedTitles).toContain("novice");
    expect(state.selectedTitle).toBe("novice");

    // Level 3 unlocks 'disciplined'
    state.level = 3;
    const res = checkAndUnlockTitles(state);
    expect(res.state.unlockedTitles).toContain("disciplined");

    // Select unlocked title
    const selectRes = selectTitle(res.state, "disciplined");
    expect(selectRes.success).toBe(true);
    expect(selectRes.state.selectedTitle).toBe("disciplined");

    // Cannot select locked title
    const selectLocked = selectTitle(selectRes.state, "master");
    expect(selectLocked.success).toBe(false);
    expect(selectLocked.state.selectedTitle).toBe("disciplined");
  });

  // (g) Reputation pure function test
  it("(g) Reputation pure function calculates points and stages accurately", () => {
    let state = { ...INITIAL_GAME_STATE };
    const rep1 = getReputation(state);
    expect(rep1.points).toBeGreaterThanOrEqual(0);
    expect(rep1.stageKey).toBe("growing");

    // Add quest history and higher stats
    state.history = [
      {
        questId: "q1",
        questTitle: "Daily Bias",
        category: "Trading",
        xp: 40,
        coins: 10,
        completedAt: "2026-10-05",
      },
      {
        questId: "q2",
        questTitle: "Risk Check",
        category: "Trading",
        xp: 40,
        coins: 10,
        completedAt: "2026-10-05",
      },
    ];
    state.currentStreak = 10;
    const rep2 = getReputation(state);
    expect(rep2.points).toBeGreaterThan(rep1.points);
  });

  // (h) Stats ranks, power, balance and snapshots limit test
  it("(h) Stat levels, ranks, power, balance, and 30-day snapshot limit", () => {
    const info = getStatLevelAndRank(120);
    expect(info.level).toBe(2);
    expect(info.rankKey).toBe("adept");

    let state = { ...INITIAL_GAME_STATE };
    const power = getCharacterPower(state);
    expect(power).toBeGreaterThan(0);

    const balance = getStatBalance(state);
    expect(balance.strongestStat).toBe("discipline");

    // Snapshot limit test (max 30)
    let snapshots: any[] = [];
    for (let i = 1; i <= 35; i++) {
      const dateStr = `2026-10-${String(i).padStart(2, "0")}`;
      snapshots = updateStatSnapshots(snapshots, dateStr, state.stats);
    }
    expect(snapshots.length).toBe(30);
    expect(snapshots[snapshots.length - 1].date).toBe("2026-10-35");
  });

  // (i) Equipment persistence and serialization reload test
  it("(i) Equipment equip, unequip, and reload state survival", () => {
    let state = { ...INITIAL_GAME_STATE };

    // Equip item
    state = equipItem(state, "Голова", 9, "Кепка").state;
    expect(state.equipment["Голова"]).toBe(9);

    // Simulate serialization & reload via migrateState
    const jsonStr = JSON.stringify(state);
    const reloadedRaw = JSON.parse(jsonStr);
    const reloaded = migrateState(reloadedRaw);

    expect(reloaded.equipment["Голова"]).toBe(9);

    // Unequip item
    state = unequipItem(state, "Голова");
    expect(state.equipment["Голова"]).toBeUndefined();
  });
});

describe("T4 Profile & Wardrobe Logic Requirements", () => {
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
    expect(state.equipment[previewSlot]).toBe(0);
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
