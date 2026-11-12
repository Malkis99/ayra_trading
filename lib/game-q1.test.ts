import { describe, it, expect } from "vitest";
import legacy from "./__fixtures__/game-state-legacy.json";
import {
  INITIAL_GAME_STATE,
  addCustomGoal,
  checkAndApplyDateResets,
  claimDailyReward,
  completeQuest,
  gameDayKey,
  migrateState,
  normalizeGoalTitle,
  recordLoggedTrade,
  recordScreenshotAdded,
  replaceQuest,
  toggleRestDay,
  type GameState,
} from "./game";
import { GAME_CONFIG } from "./game-config";
import { APP_CLOSED_QUESTS, QUEST_POOL, getTodaysQuests, questReward } from "./quests";
import { GameStore } from "./game-store";

const at = (iso: string) => new Date(iso);

/** A fresh state in a zone, already started on `day` (lastSeenAt set so the clock is not «behind»). */
function stateIn(zone: string, nowIso: string, extra: Partial<GameState> = {}): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: zone }, ...extra } as GameState;
  return checkAndApplyDateResets(base, at(nowIso));
}

describe("Q1: the game day follows the account time zone", () => {
  it("starts the day by the account zone (Tbilisi is a day ahead of UTC at 20:30 UTC)", () => {
    const s = stateIn("Asia/Tbilisi", "2026-11-12T20:30:00Z");
    expect(s.lastQuestDate).toBe("2026-11-13");
    expect(gameDayKey(s, at("2026-11-12T20:30:00Z"))).toBe("2026-11-13");
  });

  it("midnight: a new day once, and the closed day gives nothing again", () => {
    let s = stateIn("UTC", "2026-11-12T23:59:00Z");
    s = completeQuest(s, "q_walk", "Walk", "Physical", 30, 0, at("2026-11-12T23:59:30Z")).state;
    const xpAfterFirst = s.xp + s.level * 1000;
    // the same quest just before midnight again: nothing
    s = completeQuest(s, "q_walk", "Walk", "Physical", 30, 0, at("2026-11-12T23:59:59Z")).state;
    expect(s.xp + s.level * 1000).toBe(xpAfterFirst);
    // after midnight: a new day, the streak grows once
    s = checkAndApplyDateResets(s, at("2026-11-13T00:00:01Z"));
    expect(s.lastQuestDate).toBe("2026-11-13");
    expect(s.currentStreak).toBe(1);
    expect(s.completedQuestsToday).toEqual({});
    // checking again in the same new day does not move the streak
    s = checkAndApplyDateResets(s, at("2026-11-13T00:05:00Z"));
    expect(s.currentStreak).toBe(1);
  });

  it("a zone «behind» keeps the current day open: no lock-out, no second day", () => {
    let s = stateIn("Pacific/Kiritimati", "2026-11-12T11:00:00Z"); // UTC+14 → 2026-11-13
    expect(s.lastQuestDate).toBe("2026-11-13");
    s = completeQuest(s, "q_walk", "Walk", "Physical", 30, 0, at("2026-11-12T11:01:00Z")).state;
    // move to UTC−12 (still 2026-11-11 there): the game day stays 2026-11-13, its quests stay open
    s = { ...s, profile: { ...s.profile, timezone: "Etc/GMT+12" } };
    s = checkAndApplyDateResets(s, at("2026-11-12T11:02:00Z"));
    expect(s.lastQuestDate).toBe("2026-11-13");
    expect(s.completedQuestsToday.q_walk).toBe(true);
    const r = completeQuest(s, "q_read_pages", "Read", "Mental", 30, 0, at("2026-11-12T11:03:00Z"));
    expect(r.state.completedQuestsToday.q_read_pages).toBe(true); // not blocked
    // the walk cannot be taken again for 2026-11-13
    const again = completeQuest(r.state, "q_walk", "Walk", "Physical", 30, 0, at("2026-11-12T11:04:00Z"));
    expect(again.state.xp).toBe(r.state.xp);
  });

  it("switching zones back and forth within an hour never gives more than one extra day", () => {
    let s = stateIn("Etc/GMT+12", "2026-11-12T11:00:00Z"); // 2026-11-11
    const days = new Set<string>([s.lastQuestDate]);
    const zones = ["Pacific/Kiritimati", "Etc/GMT+12", "Pacific/Kiritimati", "Etc/GMT+12", "Pacific/Kiritimati"];
    zones.forEach((zone, i) => {
      s = { ...s, profile: { ...s.profile, timezone: zone } };
      s = checkAndApplyDateResets(s, at(`2026-11-12T11:${String(10 + i * 10).padStart(2, "0")}:00Z`));
      days.add(s.lastQuestDate);
      s = claimDailyReward(s, at(`2026-11-12T11:${String(11 + i * 10).padStart(2, "0")}:00Z`)).state;
    });
    // 2026-11-11 → 2026-11-13 is one jump; the day never goes back afterwards
    expect([...days].sort()).toEqual(["2026-11-11", "2026-11-13"]);
    expect(s.lastQuestDate).toBe("2026-11-13");
    // one daily reward per game day at most
    expect(s.coinLog?.filter((c) => c.source === "dailyReward").length).toBeLessThanOrEqual(2);
  });

  it("the daily reward is once per game day after a zone change", () => {
    let s = stateIn("UTC", "2026-11-12T10:00:00Z");
    s = claimDailyReward(s, at("2026-11-12T10:00:00Z")).state;
    const coins = s.coins;
    s = { ...s, profile: { ...s.profile, timezone: "America/New_York" } }; // still 2026-11-12 there
    s = claimDailyReward(s, at("2026-11-12T10:05:00Z")).state;
    expect(s.coins).toBe(coins);
  });
});

describe("Q1: rest day keeps the streak but does not grow it", () => {
  it("rest only: same streak, no shield spent", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z", { currentStreak: 5, bestStreak: 5, streakShieldsAvailable: 1 });
    s = toggleRestDay(s, at("2026-11-12T09:01:00Z"));
    s = checkAndApplyDateResets(s, at("2026-11-13T09:00:00Z"));
    expect(s.currentStreak).toBe(5);
    expect(s.streakShieldsAvailable).toBe(1);
  });

  it("switching rest on and off gives nothing and keeps the final state for the day only", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const before = { xp: s.xp, coins: s.coins, level: s.level };
    s = toggleRestDay(s, at("2026-11-12T09:01:00Z"));
    s = toggleRestDay(s, at("2026-11-12T09:02:00Z"));
    s = toggleRestDay(s, at("2026-11-12T09:03:00Z"));
    s = toggleRestDay(s, at("2026-11-12T09:04:00Z"));
    expect({ xp: s.xp, coins: s.coins, level: s.level }).toEqual(before);
    expect(s.isRestDay).toBe(false);
    expect(s.dailyStats["2026-11-12"].isRestDay).toBe(false);
    expect(s.dailyStats["2026-11-11"]).toBeUndefined();
  });

  it("a quest done on a rest day still counts as an active day", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z", { currentStreak: 2 });
    s = toggleRestDay(s, at("2026-11-12T09:01:00Z"));
    s = completeQuest(s, "q_walk", "Walk", "Physical", 30, 0, at("2026-11-12T09:02:00Z")).state;
    s = checkAndApplyDateResets(s, at("2026-11-13T09:00:00Z"));
    expect(s.currentStreak).toBe(3);
  });
});

describe("Q1: «Replace» really replaces", () => {
  const day = "2026-11-12";
  const now = at("2026-11-12T09:00:00Z");
  const shown = () => {
    const q = getTodaysQuests(day);
    return [...q.core, ...q.bonus];
  };

  it("gives another quest: not shown, not checked by the journal, no more XP; stable after reload", () => {
    const s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const target = shown().find((q) => !APP_CLOSED_QUESTS.has(q.id))!;
    const r = replaceQuest(s, target.id, shown().map((q) => q.id), now);
    expect(r.success).toBe(true);
    const to = QUEST_POOL.find((q) => q.id === r.replacementId)!;
    expect(shown().map((q) => q.id)).not.toContain(to.id);
    expect(APP_CLOSED_QUESTS.has(to.id)).toBe(false);
    expect(questReward(to).xp).toBeLessThanOrEqual(questReward(target).xp);
    const reloaded = migrateState(JSON.parse(JSON.stringify(r.state)));
    const set = getTodaysQuests(day, reloaded.questReplacements);
    expect([...set.core, ...set.bonus].map((q) => q.id)).toContain(to.id);
    expect(set.replacedFrom[to.id]).toBe(target.id);
  });

  it("the replaced quest cannot be completed; the limit is 2 a day; journal quests are not replaceable", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const ids = () => {
      const q = getTodaysQuests(day, s.questReplacements);
      return [...q.core, ...q.bonus].map((x) => x.id);
    };
    const selfQuests = shown().filter((q) => !APP_CLOSED_QUESTS.has(q.id));
    const first = replaceQuest(s, selfQuests[0].id, ids(), now);
    s = first.state;
    expect(completeQuest(s, selfQuests[0].id, "x", "Mental", 30, 0, now).state.xp).toBe(s.xp);
    const second = replaceQuest(s, selfQuests[1].id, ids(), now);
    expect(second.success).toBe(true);
    s = second.state;
    const third = replaceQuest(s, selfQuests[2]?.id ?? first.replacementId!, ids(), now);
    expect(third.success).toBe(false);
    expect(third.reason).toBe("limit");
    expect(s.replacementsUsedToday).toBe(GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY);

    const fresh = stateIn("UTC", "2026-11-12T09:00:00Z");
    expect(replaceQuest(fresh, "q_tradelog", ids(), now)).toMatchObject({ success: false, reason: "notReplaceable" });
  });

  it("a replacement can be replaced again: the newest one is shown", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const ids = () => {
      const q = getTodaysQuests(day, s.questReplacements);
      return [...q.core, ...q.bonus].map((x) => x.id);
    };
    const target = shown().find((q) => !APP_CLOSED_QUESTS.has(q.id))!;
    const first = replaceQuest(s, target.id, ids(), now);
    s = first.state;
    const second = replaceQuest(s, first.replacementId!, ids(), now);
    expect(second.success).toBe(true);
    s = second.state;
    const set = getTodaysQuests(day, s.questReplacements);
    const visible = [...set.core, ...set.bonus].map((q) => q.id);
    expect(visible).toContain(second.replacementId);
    expect(visible).not.toContain(first.replacementId);
    expect(visible).not.toContain(target.id);
    expect(set.replacedFrom[second.replacementId!]).toBe(target.id);
    // neither the original nor the first replacement can be completed now
    expect(completeQuest(s, target.id, "x", "Mental", 30, 0, now).state.xp).toBe(s.xp);
    expect(completeQuest(s, first.replacementId!, "x", "Mental", 30, 0, now).state.xp).toBe(s.xp);
  });

  it("replacements reset with the new day", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const target = shown().find((q) => !APP_CLOSED_QUESTS.has(q.id))!;
    s = replaceQuest(s, target.id, shown().map((q) => q.id), now).state;
    s = checkAndApplyDateResets(s, at("2026-11-13T09:00:00Z"));
    expect(s.questReplacements).toEqual({});
    expect(s.replacementsUsedToday).toBe(0);
  });
});

describe("Q1: the trade-log quest closes only with a believable trade", () => {
  const trade = (id: string, openedAt: string) => ({ id, accountId: "a1", instrument: "EURUSD", direction: "long", openedAt, verification: "unverified" });

  it("a duplicate does not close it", () => {
    const s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const t1 = trade("t1", "2026-11-12T08:00:00Z");
    const dup = trade("t2", "2026-11-12T08:00:30Z");
    const r = recordLoggedTrade(s, dup, [t1, dup], at("2026-11-12T09:00:00Z"));
    expect(r.questClosed).toBe(false);
    expect(r.state.completedQuestsToday.q_tradelog).toBeUndefined();
  });

  it("a trade dated in the future does not close it", () => {
    const s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const t = trade("t1", "2026-11-20T08:00:00Z");
    const r = recordLoggedTrade(s, t, [t], at("2026-11-12T09:00:00Z"));
    expect(r.questClosed).toBe(false);
  });

  it("an imported trade does not close it; a real one does, once", () => {
    const s = stateIn("UTC", "2026-11-12T09:00:00Z");
    const imp = { ...trade("t1", "2026-11-12T08:00:00Z"), verification: "imported" };
    expect(recordLoggedTrade(s, imp, [imp], at("2026-11-12T09:00:00Z")).questClosed).toBe(false);
    const real = trade("t2", "2026-11-12T08:30:00Z");
    const r1 = recordLoggedTrade(s, real, [real], at("2026-11-12T09:00:00Z"));
    expect(r1.questClosed).toBe(true);
    const other = { ...trade("t3", "2026-11-12T08:45:00Z"), instrument: "GBPUSD" };
    const r2 = recordLoggedTrade(r1.state, other, [real, other], at("2026-11-12T09:01:00Z"));
    expect(r2.questClosed).toBe(false);
    expect(r2.state.coins).toBe(r1.state.coins);
  });
});

describe("Q1: personal goal titles (≤ 80, owner decision)", () => {
  it("trims, joins spaces, refuses empty and too long", () => {
    expect(normalizeGoalTitle("  Не   рисковать  ")).toBe("Не рисковать");
    expect(normalizeGoalTitle("   ")).toBeNull();
    expect(normalizeGoalTitle("x".repeat(80))).toHaveLength(80);
    expect(normalizeGoalTitle("x".repeat(81))).toBeNull();
  });

  it("adds valid goals with unique ids, up to 5", () => {
    let s = stateIn("UTC", "2026-11-12T09:00:00Z");
    s = addCustomGoal(s, "   ", "Trading");
    expect(s.customGoals).toHaveLength(0);
    for (let i = 0; i < 7; i++) s = addCustomGoal(s, `Goal ${i}`, "Trading");
    expect(s.customGoals).toHaveLength(GAME_CONFIG.MAX_CUSTOM_GOALS);
    expect(new Set(s.customGoals.map((g) => g.id)).size).toBe(GAME_CONFIG.MAX_CUSTOM_GOALS);
  });
});

describe("Q1: screenshot XP through the shared store", () => {
  function storeOver(saved: { raw: string }) {
    const store = new GameStore<GameState>({
      read: () => saved.raw,
      write: (raw) => {
        saved.raw = raw;
        return true;
      },
      parse: (raw) => checkAndApplyDateResets(JSON.parse(raw), at("2026-11-12T09:00:00Z")),
    });
    store.noteLoaded(saved.raw);
    return store;
  }
  const shot = { hash: "hash_new", width: 1200, height: 800, tradeOpenedAt: "2026-11-12T08:00:00Z" };

  it("the same screenshot twice and a repeated request give XP once; other game data stays", async () => {
    const start = stateIn("UTC", "2026-11-12T09:00:00Z", { posts: ["keep me"], customGoals: [{ id: "g", title: "Keep", category: "Trading", createdAt: "2026-11-01" }] });
    const saved = { raw: JSON.stringify(start) };
    const store = storeOver(saved);
    let memory = start;
    const give = async () => {
      const out = await store.applyLocked(() => memory, (fresh) => {
        const r = recordScreenshotAdded(fresh, shot, at("2026-11-12T09:00:00Z"));
        return { state: r.state, result: r.xpAwarded };
      });
      memory = out.state;
      return out.result;
    };
    const [a, b] = await Promise.all([give(), give()]);
    expect(a + b).toBe(GAME_CONFIG.SCREENSHOT_XP);
    expect(await give()).toBe(0);
    const final = JSON.parse(saved.raw) as GameState;
    expect(final.rewardedScreenshotHashes).toContain("hash_new");
    expect(final.posts).toEqual(["keep me"]);
    expect(final.customGoals).toHaveLength(1);
  });

  it("two tabs with different screenshots stay within the daily cap", async () => {
    const start = stateIn("UTC", "2026-11-12T09:00:00Z");
    const saved = { raw: JSON.stringify(start) };
    const tabA = storeOver(saved);
    const tabB = storeOver(saved);
    let memA = start;
    let memB = start;
    const [ra, rb] = await Promise.all([
      tabA.applyLocked(() => memA, (f) => {
        const r = recordScreenshotAdded(f, { ...shot, hash: "h1" }, at("2026-11-12T09:00:00Z"));
        return { state: r.state, result: r.xpAwarded };
      }),
      tabB.applyLocked(() => memB, (f) => {
        const r = recordScreenshotAdded(f, { ...shot, hash: "h2" }, at("2026-11-12T09:00:00Z"));
        return { state: r.state, result: r.xpAwarded };
      }),
    ]);
    memA = ra.state;
    memB = rb.state;
    expect(ra.result + rb.result).toBe(GAME_CONFIG.SCREENSHOT_XP * GAME_CONFIG.SCREENSHOT_DAILY_XP_CAP);
  });
});

describe("Q1: an old save keeps everything", () => {
  it("XP, Coins, level, achievements, items, titles, history, chronicle and coin log are unchanged", () => {
    const old = JSON.parse(JSON.stringify(legacy));
    const s = checkAndApplyDateResets(old, at("2026-11-12T09:00:00Z"));
    expect(s.xp).toBe(legacy.xp);
    expect(s.coins).toBe(legacy.coins);
    expect(s.level).toBe(legacy.level);
    expect(s.achievements).toEqual(legacy.achievements);
    expect(s.equipment).toEqual(legacy.equipment);
    for (const t of legacy.unlockedTitles) expect(s.unlockedTitles).toContain(t); // titles earned by level are added, never removed
    expect(s.selectedTitle).toBe(legacy.selectedTitle);
    expect(s.history).toEqual(legacy.history);
    expect(s.chronicle).toEqual(legacy.chronicle);
    expect(s.coinLog).toEqual(legacy.coinLog);
    expect(s.coinLogSince).toBe(legacy.coinLogSince);
    expect(s.rewardedScreenshotHashes).toEqual(legacy.rewardedScreenshotHashes);
    expect(s.customGoals).toEqual(legacy.customGoals);
    expect(s.firstActions).toEqual(legacy.firstActions);
    expect(s.dailyStats["2026-11-10"]).toEqual(legacy.dailyStats["2026-11-10"]);
    // a new day in Tbilisi: yesterday had a quest → the streak grows by one, as before
    expect(s.lastQuestDate).toBe("2026-11-12");
    expect(s.currentStreak).toBe(legacy.currentStreak + 1);
    expect(s.questReplacements).toEqual({});
  });
});
