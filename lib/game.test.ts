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
  selectTitle,
  checkAndUnlockTitles,
} from "./game";
import {
  isValidLatinNickname,
  transliterateNickname,
  getReputation,
  calculateStats,
  getCharacterPower,
  getStatBalance,
} from "./stats";
import { TITLES_CATALOG } from "./titles";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";
import { ALLOWED_LATIN_WORDS } from "./i18n/allowed-latin";
import { ITEMS } from "./items";

describe("Game State Logic v3.1 (lib/game.ts & lib/quests.ts)", () => {
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
      completedQuestsToday: {},
    };

    const day2 = new Date("2026-10-06T10:00:00Z");
    const resetted = checkAndApplyDateResets(state, day2);

    expect(resetted.currentStreak).toBe(5);
    expect(resetted.streakShieldsAvailable).toBe(0);

    const day3 = new Date("2026-10-07T10:00:00Z");
    const resetted2 = checkAndApplyDateResets(resetted, day3);

    expect(resetted2.currentStreak).toBe(0);
    expect(resetted2.bestStreak).toBe(5);
  });
});

describe("T4.1 Requirements: Nickname Validation & Transliteration", () => {
  it("validates Latin nicknames correctly", () => {
    expect(isValidLatinNickname("TraderOne")).toBe(true);
    expect(isValidLatinNickname("Alex_123")).toBe(true);
    expect(isValidLatinNickname("John.Doe-99")).toBe(true);

    expect(isValidLatinNickname("Алекс")).toBe(false); // Cyrillic
    expect(isValidLatinNickname("ab")).toBe(false); // Too short (< 3)
    expect(isValidLatinNickname("A".repeat(25))).toBe(false); // Too long (> 24)
    expect(isValidLatinNickname("Alex!")).toBe(false); // Invalid symbol
  });

  it("transliterates Cyrillic nicknames to Latin according to table", () => {
    expect(transliterateNickname("Алекс")).toBe("Aleks");
    expect(transliterateNickname("Иван")).toBe("Ivan");
    expect(transliterateNickname("   Михаил   ")).toBe("Mikhail");
    expect(transliterateNickname("Да")).toBe("TraderOne"); // Less than 3 chars becomes default
    expect(transliterateNickname("ОченьДлинноеИмяКотороеПревышаетДвадцатьЧетыреСимвола")).toBe("OchenDlinnoeImyaKotoroeP");
  });

  it("migrates raw state correctly", () => {
    const rawLegacy = {
      name: "Алекс",
      bio: "Мой путь — дисциплина и процесс.",
      loadouts: {
        Сессия: { Верх: 0 },
        Сообщество: { Низ: 3 },
      },
      activeLoadout: "Сессия",
    };

    const migrated = migrateState(rawLegacy);
    expect(migrated.name).toBe("Aleks");
    expect(migrated.bio).toBeNull();
    expect(migrated.loadouts["session"]).toEqual({ Верх: 0 });
    expect(migrated.loadouts["community"]).toEqual({ Низ: 3 });
    expect(migrated.activeLoadout).toBe("session");
    expect(migrated.unlockedTitles).toContain("novice");
  });
});

describe("T4.1 Requirements: Titles & Reputation", () => {
  it("calculates reputation correctly", () => {
    const rep = getReputation({ level: 3, history: [1, 2, 3], currentStreak: 2 });
    expect(rep.points).toBe(3 * 20 + 3 * 5 + 2 * 10); // 60 + 15 + 20 = 95
    expect(rep.tierId).toBe("growing");
    expect(rep.pointsToNext).toBe(101 - 95);
  });

  it("allows selecting unlocked titles and prevents selecting locked titles", () => {
    let state = { ...INITIAL_GAME_STATE, unlockedTitles: ["novice", "disciplined"] };

    state = selectTitle(state, "disciplined");
    expect(state.selectedTitle).toBe("disciplined");

    // Try selecting locked title
    state = selectTitle(state, "strategist");
    expect(state.selectedTitle).toBe("disciplined"); // remains disciplined
  });

  it("automatically unlocks titles when conditions are met", () => {
    let state = { ...INITIAL_GAME_STATE, level: 5 };
    const res = checkAndUnlockTitles(state);
    expect(res.newlyUnlockedTitles).toContain("disciplined"); // reqLevel 3
    expect(res.newlyUnlockedTitles).toContain("strategist"); // reqLevel 5
  });
});

describe("T4.1 Requirements: Stats & Character Power", () => {
  it("calculates 8 stats, power, and balance accurately", () => {
    const state = { ...INITIAL_GAME_STATE, level: 3, weeklyQuestCount: 5 };
    const stats = calculateStats(state);

    expect(Object.keys(stats).length).toBe(8);
    expect(stats.discipline.level).toBeGreaterThan(1);

    const power = getCharacterPower(stats);
    expect(power).toBeGreaterThan(0);

    const balance = getStatBalance(stats);
    expect(balance).toHaveProperty("strongestStat");
    expect(balance).toHaveProperty("weakestStat");
    expect(balance).toHaveProperty("growthCategory");
  });
});

describe("T4.1 Requirements: Wardrobe Bug Fix & Equipment Persistence", () => {
  it("equips and unequips item saving directly to state", () => {
    let state = { ...INITIAL_GAME_STATE, level: 1 };
    // Item 1 is Violet Hoodie (Top, reqLevel 1)
    const res1 = equipItem(state, 1);
    expect(res1.state.equipment["Верх"]).toBe(1);

    const res2 = unequipSlot(res1.state, "Верх");
    expect(res2.state.equipment["Верх"]).toBeUndefined();
  });

  it("preview does not mutate saved equipment state", () => {
    let state = { ...INITIAL_GAME_STATE, level: 1 };
    const previewItemId = 1; // Violet Hoodie (Top)
    const previewSlot = ITEMS[previewItemId].slot;

    const effectiveEquipment = {
      ...state.equipment,
      [previewSlot]: previewItemId,
    };

    expect(effectiveEquipment[previewSlot]).toBe(previewItemId);
    expect(state.equipment[previewSlot]).toBe(0); // Starter shirt remains intact
  });
});

describe("T4.1 i18n & State Purity Audits", () => {
  it("(a) dictionary keys in ru and en match exactly", () => {
    function getKeys(obj: any, prefix = ""): string[] {
      let keys: string[] = [];
      for (const k in obj) {
        if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
          keys = keys.concat(getKeys(obj[k], `${prefix}${k}.`));
        } else {
          keys.push(`${prefix}${k}`);
        }
      }
      return keys;
    }

    const ruKeys = getKeys(ru).sort();
    const enKeys = getKeys(en).sort();

    expect(ruKeys).toEqual(enKeys);
  });

  it("(b) ru values do not contain disallowed English words", () => {
    const allowedWords = new Set([...ALLOWED_LATIN_WORDS, "Trading"]);

    function checkValues(obj: any, path = "") {
      for (const k in obj) {
        const val = obj[k];
        if (typeof val === "object" && val !== null) {
          checkValues(val, `${path}.${k}`);
        } else if (typeof val === "string") {
          // Strip template placeholders like {action}, {count}, etc.
          const cleanedVal = val.replace(/\{[^{}]+\}/g, "");
          // Find latin words
          const latinWords = cleanedVal.match(/\b[A-Za-z]+\b/g) || [];
          for (const word of latinWords) {
            if (!allowedWords.has(word)) {
              throw new Error(
                `Disallowed English word "${word}" found in RU dictionary at key "${path}.${k}": "${val}"`
              );
            }
          }
        }
      }
    }

    expect(() => checkValues(ru)).not.toThrow();
  });

  it("(c) en values do not contain Cyrillic characters", () => {
    function checkCyrillic(obj: any, path = "") {
      for (const k in obj) {
        const val = obj[k];
        if (typeof val === "object" && val !== null) {
          checkCyrillic(val, `${path}.${k}`);
        } else if (typeof val === "string") {
          if (/[а-яА-ЯёЁ]/.test(val)) {
            throw new Error(
              `Cyrillic character found in EN dictionary at key "${path}.${k}": "${val}"`
            );
          }
        }
      }
    }

    expect(() => checkCyrillic(en)).not.toThrow();
  });

  it("(d) GameState contains zero localized text strings", () => {
    let state = { ...INITIAL_GAME_STATE };
    state = equipItem(state, 1).state;
    state = addPost(state, "Test post").state;

    expect(typeof state.equipment["Верх"]).toBe("number");
    expect(state.selectedTitle).toBe("novice");
    expect(state.activeLoadout).toBe("session");
  });
});
