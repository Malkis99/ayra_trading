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
} from "./game";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";

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
    ]);

    function checkValues(obj: any) {
      for (const k in obj) {
        if (typeof obj[k] === "object" && obj[k] !== null) {
          checkValues(obj[k]);
        } else if (typeof obj[k] === "string") {
          const latinWords = obj[k].match(/[A-Za-z]+/g) || [];
          for (const word of latinWords) {
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
    state = equipItem(state, "Голова", 9, "Кепка");
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
