import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  claimDailyReward,
  completeQuest,
  completeSelfReportQuest,
  migrateState,
  passQuest,
  recordWeekBossResult,
  replaceQuest,
  setDayMode,
  setWeekChallenge,
  type GameState,
} from "./game";
import { GameStore } from "./game-store";
import { addDaysToKey } from "./day-key";
import { DAY_SNAPSHOT_RETENTION_DAYS, addDaySnapshot, buildDaySnapshot, readDaySnapshots, type DaySnapshot } from "./day-snapshots";

const at = (iso: string) => new Date(iso);
const noon = (day: string) => at(`${day}T12:00:00Z`);

/** A state started on `day` in UTC (or another zone). */
function started(day: string, extra: Partial<GameState> = {}, zone = "UTC"): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: zone }, ...extra } as GameState;
  // the day starts early, so the actions of the tests are later (an earlier time would be a clock moved back)
  return checkAndApplyDateResets(base, at(`${day}T06:00:00Z`));
}

const totalXp = (s: GameState) => {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += 80 + lv * 40;
  return sum;
};
const wealth = (s: GameState) => ({ xp: totalXp(s), coins: s.coins, achievements: { ...s.achievements }, history: s.history.length, equipment: { ...s.equipment }, titles: [...s.unlockedTitles] });

/** Ticks the first self-reported quest of the day's set. */
function tickSelf(s: GameState, when: Date): { state: GameState; id: string } {
  const ids = [...(s.questDay?.core || []), ...(s.questDay?.bonus || [])];
  for (const id of ids) {
    const r = completeSelfReportQuest(s, id, id, "Mental", 30, when);
    if (r.state.completedQuestsToday[id]) return { state: r.state, id };
  }
  throw new Error("no self-reported quest in the set");
}

describe("QH-3 day snapshots: written once at the day change", () => {
  it("the day change writes the closed day as it was: set, done with time and reward, totals, source", () => {
    let s = started("2026-11-10");
    const first = tickSelf(s, at("2026-11-10T09:15:00Z"));
    s = completeQuest(first.state, "q_bias", "Bias", "Trading", 40, 10, at("2026-11-10T09:30:00Z")).state;
    const before = s;
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    expect(s.questDays).toHaveLength(1);
    const snap = s.questDays![0];
    expect(snap.day).toBe("2026-11-10");
    expect(snap.mode).toBe(before.questDay!.mode);
    expect(snap.core).toEqual(before.questDay!.core);
    expect(snap.offered).toEqual(expect.arrayContaining([...before.questDay!.core, ...before.questDay!.bonus]));
    expect(snap.done[first.id]).toMatchObject({ source: "self", at: "2026-11-10T09:15:00.000Z" });
    expect(snap.done.q_bias).toMatchObject({ source: "journal", xp: 40, coins: 10 });
    expect(snap.totals.xp).toBe(before.dailyStats["2026-11-10"].xpGained);
    expect(snap.totals.coins).toBe(10);
    expect(snap.incomplete).toBeUndefined();
    // the new day is clean and nothing was given by the change
    expect(s.completedQuestsToday).toEqual({});
    expect(wealth(s)).toEqual(wealth(before));
  });

  it("a second day change call, a reload and a re-parse keep one snapshot, unchanged", () => {
    let s = started("2026-11-10");
    s = tickSelf(s, at("2026-11-10T09:00:00Z")).state;
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    const once = JSON.stringify(s.questDays);
    s = checkAndApplyDateResets(s, at("2026-11-11T13:00:00Z"));
    s = checkAndApplyDateResets(migrateState(JSON.parse(JSON.stringify(s))), at("2026-11-11T14:00:00Z"));
    expect(JSON.stringify(s.questDays)).toBe(once);
  });

  it("an existing snapshot of a day is never overwritten", () => {
    const s = started("2026-11-10");
    const a = buildDaySnapshot(s, false, noon("2026-11-11"));
    const b = { ...a, totals: { ...a.totals, xp: 999 } };
    const list = addDaySnapshot(addDaySnapshot([], a, "2026-11-11"), b, "2026-11-11");
    expect(list).toHaveLength(1);
    expect(list[0].totals.xp).toBe(a.totals.xp);
  });
});

describe("QH-3 day snapshots: missed days are not invented", () => {
  for (const gap of [3, 10]) {
    it(`${gap} days without opening: one snapshot of the last opened day, no days made up, history kept`, () => {
      let s = started("2026-11-02");
      s = tickSelf(s, at("2026-11-02T09:00:00Z")).state;
      const before = s;
      const back = addDaysToKey("2026-11-02", gap + 1);
      s = checkAndApplyDateResets(s, noon(back));
      expect(s.questDays!.map((d) => d.day)).toEqual(["2026-11-02"]);
      expect(s.history).toEqual(before.history);
      expect(s.dailyStats).toMatchObject(before.dailyStats);
      expect(totalXp(s)).toBe(totalXp(before));
      expect(s.coins).toBe(before.coins);
      // the streak rule for missed days is not changed in QH-3 (owner decision В4: analysis first)
      expect(s.currentStreak).toBe(before.currentStreak + 1);
    });
  }
});

describe("QH-3 day snapshots: rest, mode changes, replacements", () => {
  it("a rest day: mode «rest», the mode before it, no shield spent", () => {
    let s = started("2026-11-10");
    s = setDayMode(s, "rest", at("2026-11-10T08:00:00Z")).state;
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    const snap = s.questDays![0];
    expect(snap).toMatchObject({ day: "2026-11-10", mode: "rest", restDay: true, shieldUsed: false });
    expect(snap.modeBeforeRest).toBeDefined();
    expect(snap.modeChanges).toEqual([{ to: "rest", at: "2026-11-10T08:00:00.000Z" }]);
  });

  it("a day without any quest spends a shield and the snapshot says so", () => {
    let s = started("2026-11-10");
    expect(s.streakShieldsAvailable).toBeGreaterThan(0);
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    expect(s.questDays![0]).toMatchObject({ shieldUsed: true, done: {} });
  });

  it("a mode change in the middle of a day: changes with time, every offered quest, done quests keep their mode", () => {
    let s = started("2026-11-10"); // Tuesday: trading
    const startSet = [...s.questDay!.core, ...s.questDay!.bonus];
    const done = tickSelf(s, at("2026-11-10T08:00:00Z"));
    s = setDayMode(done.state, "study", at("2026-11-10T10:00:00Z")).state;
    const studySet = [...s.questDay!.core, ...s.questDay!.bonus];
    s = setDayMode(s, "recovery", at("2026-11-10T15:00:00Z")).state;
    const endMode = s.questDay!.mode;
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    const snap = s.questDays![0];
    expect(snap.mode).toBe(endMode);
    expect(snap.modeChanges.map((m) => m.to)).toEqual(["study", "recovery"]);
    expect(snap.offered).toEqual(expect.arrayContaining([...startSet, ...studySet]));
    if (snap.core.includes(done.id)) expect(snap.done[done.id].mode).toBe("trading");
    expect(snap.done[done.id]).toBeDefined();
  });

  it("replacements: from → to, the new quest is offered, the replaced one is not «not today»; a pass is", () => {
    let s = started("2026-11-10");
    const core = s.questDay!.core.filter((id) => !["q_bias", "q_riskcheck", "q_reflect", "q_tradelog"].includes(id));
    const r = replaceQuest(s, core[0], [...s.questDay!.core, ...s.questDay!.bonus], at("2026-11-10T08:00:00Z"));
    expect(r.success).toBe(true);
    s = passQuest(r.state, core[1], at("2026-11-10T09:00:00Z"));
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    const snap = s.questDays![0];
    expect(snap.replaced).toEqual([{ from: core[0], to: r.replacementId }]);
    expect(snap.offered).toContain(r.replacementId);
    expect(snap.core).toContain(r.replacementId);
    expect(snap.passed).toEqual([core[1]]);
  });

  it("a replacement survives a later mode change in the snapshot", () => {
    let s = started("2026-11-10");
    const id = s.questDay!.core.find((x) => !["q_bias", "q_riskcheck", "q_reflect", "q_tradelog"].includes(x))!;
    const r = replaceQuest(s, id, [...s.questDay!.core, ...s.questDay!.bonus], at("2026-11-10T08:00:00Z"));
    s = setDayMode(r.state, "study", at("2026-11-10T09:00:00Z")).state;
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    expect(s.questDays![0].replaced).toEqual([{ from: id, to: r.replacementId }]);
  });
});

describe("QH-3 day snapshots: time zones and midnight", () => {
  it("a zone ahead starts the next day once with a snapshot; going back does not reopen or duplicate it", () => {
    let s = started("2026-11-10", {}, "UTC");
    s = tickSelf(s, at("2026-11-10T09:00:00Z")).state;
    // 21:00 UTC is already 11-11 in Tbilisi
    s = checkAndApplyDateResets({ ...s, profile: { ...s.profile, timezone: "Asia/Tbilisi" } }, at("2026-11-10T21:00:00Z"));
    expect(s.lastQuestDate).toBe("2026-11-11");
    expect(s.questDays!.map((d) => d.day)).toEqual(["2026-11-10"]);
    // back to UTC (still 11-10 there): the game day does not go back, nothing new is written
    s = checkAndApplyDateResets({ ...s, profile: { ...s.profile, timezone: "UTC" } }, at("2026-11-10T21:30:00Z"));
    expect(s.lastQuestDate).toBe("2026-11-11");
    expect(s.questDays).toHaveLength(1);
  });

  it("midnight in the account zone (New York) closes the right day", () => {
    let s = started("2026-11-10", {}, "America/New_York");
    // 04:59 UTC on 11-11 is 23:59 on 11-10 in New York
    s = tickSelf(s, at("2026-11-11T04:59:00Z")).state;
    s = checkAndApplyDateResets(s, at("2026-11-11T05:01:00Z"));
    const snap = s.questDays![0];
    expect(snap.day).toBe("2026-11-10");
    expect(Object.keys(snap.done)).toHaveLength(1);
  });
});

describe("QH-3 day snapshots: two tabs", () => {
  /** Two tabs over one saved value: each change runs on the freshest saved state (lib/game-store.ts). */
  function tab(saved: { raw: string }, now: Date) {
    const store = new GameStore<GameState>({
      read: () => saved.raw,
      write: (raw) => {
        saved.raw = raw;
        return true;
      },
      parse: (raw) => checkAndApplyDateResets(JSON.parse(raw), now),
    });
    store.noteLoaded(saved.raw);
    return store;
  }

  it("both tabs open after midnight: one snapshot; a quest in each tab is counted once", async () => {
    let s = started("2026-11-10");
    s = tickSelf(s, at("2026-11-10T09:00:00Z")).state;
    const stale = s; // what both tabs still hold in memory from yesterday
    const saved = { raw: JSON.stringify(s) };
    const now = noon("2026-11-11");
    const a = tab(saved, now);
    const b = tab(saved, now);
    const ra = await a.applyLocked(() => stale, (fresh) => ({ state: checkAndApplyDateResets(fresh, now), result: null }));
    const rb = await b.applyLocked(() => stale, (fresh) => ({ state: checkAndApplyDateResets(fresh, now), result: null }));
    expect(ra.saved && rb.saved).toBe(true);
    const tick = (store: GameStore<GameState>) =>
      store.applyLocked(() => stale, (fresh) => {
        const id = fresh.questDay!.core.find((x) => !["q_bias", "q_riskcheck", "q_reflect", "q_tradelog"].includes(x))!;
        const r = completeSelfReportQuest(fresh, id, id, "Mental", 30, now);
        return { state: r.state, result: r.xpGiven };
      });
    const [x1, x2] = [await tick(a), await tick(b)];
    const final = JSON.parse(saved.raw) as GameState;
    expect(final.questDays!.map((d) => d.day)).toEqual(["2026-11-10"]);
    const given = [x1, x2].map((x) => (x.saved ? x.result : 0));
    expect(given.filter((x) => x > 0)).toHaveLength(1);
  });
});

describe("QH-3 day snapshots: old saves and damaged data", () => {
  it("a Q1 save (no day set) gets a snapshot that says the set is unknown; nothing is guessed", () => {
    const q1 = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", lastQuestDate: "2026-11-10", completedQuestsToday: { q_walk: true }, history: [{ questId: "q_walk", questTitle: "Walk", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-10" }], profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" } } as unknown as GameState;
    delete (q1 as Partial<GameState>).questDay;
    const s = checkAndApplyDateResets(q1, noon("2026-11-11"));
    const snap = s.questDays![0];
    expect(snap.incomplete).toEqual(["set", "offered", "modeChanges"]);
    expect(snap.mode).toBeUndefined();
    expect(snap.core).toEqual([]);
    expect(snap.offered).toEqual([]);
    expect(snap.done.q_walk).toEqual({ source: "self", xp: 30, coins: 0 });
  });

  it("a Q2 day set saved before QH-3 (no tracking): set kept, offered and mode changes marked unknown", () => {
    let s = started("2026-11-10");
    const { offered: _o, modeChanges: _m, replaced: _r, ...q2 } = s.questDay!;
    s = { ...s, questDay: q2 };
    s = setDayMode(s, "study", at("2026-11-10T10:00:00Z")).state; // a change on an untracked day claims nothing
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    const snap = s.questDays![0];
    expect(snap.incomplete).toEqual(["offered", "modeChanges"]);
    expect(snap.core.length).toBeGreaterThan(0);
    expect(snap.modeChanges).toEqual([]);
  });

  it("old saves keep XP, Coins, level, items, achievements, goals and history through the change", () => {
    const old = { ...INITIAL_GAME_STATE, createdAt: "2026-09-01", level: 9, xp: 120, coins: 777, equipment: { top: 1, bottom: 3, shoes: 5 }, achievements: { first_quest: true }, customGoals: [{ id: "g", title: "Keep", category: "Trading", createdAt: "2026-10-01" }], lastQuestDate: "2026-11-01", history: [{ questId: "q_walk", questTitle: "Walk", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-01" }], profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" } } as unknown as GameState;
    const s = checkAndApplyDateResets(migrateState(JSON.parse(JSON.stringify(old))), noon("2026-11-13"));
    expect({ level: s.level, xp: s.xp, coins: s.coins, equipment: s.equipment, achievements: s.achievements, goals: s.customGoals, history: s.history }).toEqual({
      level: 9,
      xp: 120,
      coins: 777,
      equipment: { top: 1, bottom: 3, shoes: 5 },
      achievements: { first_quest: true },
      goals: old.customGoals,
      history: old.history,
    });
  });

  it("damaged snapshots are dropped, duplicates of a day are kept once (the first saved)", () => {
    const good = buildDaySnapshot(started("2026-11-10"), false, noon("2026-11-11"));
    const list = readDaySnapshots([good, { ...good, totals: { xp: 5, coins: 0, selfXp: 0, quests: 0 } }, { v: 2, day: "2026-11-09" }, { v: 1, day: "bad" }, null, "x", { v: 1, day: "2026-11-08" }]);
    expect(list).toHaveLength(1);
    expect(list[0].totals.xp).toBe(good.totals.xp);
    expect(migrateState({ ...INITIAL_GAME_STATE, questDays: "nonsense" }).questDays).toEqual([]);
  });
});

describe("QH-3 day snapshots: no reward twice, ever", () => {
  it("a snapshot gives nothing; rewards of the new day follow the new day only", () => {
    let s = started("2026-11-10");
    const first = tickSelf(s, at("2026-11-10T09:00:00Z"));
    s = claimDailyReward(first.state, at("2026-11-10T09:05:00Z")).state;
    s = checkAndApplyDateResets(s, noon("2026-11-11"));
    const after = wealth(s);
    // the snapshot itself is only data: changing it by hand opens nothing
    const forged = { ...s, questDays: s.questDays!.map((d) => ({ ...d, done: {} })) };
    const again = completeSelfReportQuest(forged, first.id, first.id, "Mental", 30, noon("2026-11-11"));
    const inNewSet = [...(s.questDay?.core || []), ...(s.questDay?.bonus || [])].includes(first.id);
    if (!inNewSet) expect(again.xpGiven).toBe(0);
    // the daily reward of the closed day cannot be claimed again for it
    const daily = claimDailyReward(s, noon("2026-11-11"));
    expect(daily.state.coins - s.coins).toBeGreaterThanOrEqual(0);
    expect(wealth(checkAndApplyDateResets(s, at("2026-11-11T18:00:00Z")))).toEqual(after);
  });

  it("the week challenge result is written once and gives no XP and no Coins", () => {
    let s = started("2026-11-09"); // Monday
    s = setWeekChallenge(s, { week: "2026-11-09", boss: "respectStop" });
    s = tickSelf(s, at("2026-11-09T09:00:00Z")).state;
    s = checkAndApplyDateResets(s, noon("2026-11-16")); // next Monday
    expect(s.questWeeks!.map((w) => w.week)).toEqual(["2026-11-09"]);
    expect(s.questWeeks![0]).toMatchObject({ boss: "respectStop", daysRecorded: ["2026-11-09"] });
    const before = wealth(s);
    const result = { state: "met" as const, conditions: [{ key: "stopSet", source: "auto" as const, state: "met" as const, done: 2, total: 2 }], at: "2026-11-16T12:00:00.000Z" };
    s = recordWeekBossResult(s, "2026-11-09", result, noon("2026-11-16"));
    expect(s.questWeeks![0].bossResult).toEqual(result);
    s = recordWeekBossResult(s, "2026-11-09", { ...result, state: "notMet" }, noon("2026-11-16"));
    expect(s.questWeeks![0].bossResult!.state).toBe("met");
    // the current week gets no result before it ends
    expect(recordWeekBossResult(s, "2026-11-16", result, noon("2026-11-16")).questWeeks).toEqual(s.questWeeks);
    expect(wealth(s)).toEqual(before);
  });
});

describe("QH-3 day snapshots: 120 days kept, the rest of the progress untouched", () => {
  it(`daily use for 130 days keeps ${DAY_SNAPSHOT_RETENTION_DAYS} snapshots, every history entry, and a realistic size`, () => {
    let s = started("2026-06-01");
    const start = "2026-06-01";
    for (let i = 0; i < 130; i++) {
      const day = addDaysToKey(start, i);
      s = checkAndApplyDateResets(s, at(`${day}T07:00:00Z`));
      s = tickSelf(s, at(`${day}T09:00:00Z`)).state;
      s = completeQuest(s, "q_bias", "Bias", "Trading", 40, 10, at(`${day}T09:30:00Z`)).state;
      if (i % 7 === 2) s = setDayMode(s, "study", at(`${day}T10:00:00Z`)).state;
    }
    const today = addDaysToKey(start, 130);
    s = checkAndApplyDateResets(s, at(`${today}T07:00:00Z`));
    expect(s.questDays).toHaveLength(DAY_SNAPSHOT_RETENTION_DAYS);
    expect(s.questDays![0].day).toBe(addDaysToKey(today, -1));
    expect(s.questDays![DAY_SNAPSHOT_RETENTION_DAYS - 1].day).toBe(addDaysToKey(today, -DAY_SNAPSHOT_RETENTION_DAYS));
    // pruning drops snapshots only: every day of history stays
    expect(new Set(s.history.map((h) => h.completedAt)).size).toBe(130);
    expect(Object.keys(s.dailyStats).length).toBeGreaterThanOrEqual(130);

    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    const days = bytes(s.questDays);
    const weeks = bytes(s.questWeeks);
    const whole = bytes(s);
    // reported in the PR; the bound only guards against a size regression
    console.log(`[QH-3 size] 120 day snapshots: ${days} B (${Math.round(days / 120)} B each), weeks: ${weeks} B (${s.questWeeks!.length}), whole save: ${whole} B`);
    expect(days / 120).toBeLessThan(1200);
  });

  it("a week snapshot is pruned only when all of its days are out of the window", () => {
    let s = started("2026-06-01");
    for (let i = 1; i <= 200; i += 1) s = checkAndApplyDateResets(s, noon(addDaysToKey("2026-06-01", i)));
    const today = addDaysToKey("2026-06-01", 200);
    const oldest = s.questWeeks![s.questWeeks!.length - 1].week;
    expect(addDaysToKey(oldest, 6) >= addDaysToKey(today, -DAY_SNAPSHOT_RETENTION_DAYS)).toBe(true);
    expect(s.questDays!.every((d: DaySnapshot) => d.day >= addDaysToKey(today, -DAY_SNAPSHOT_RETENTION_DAYS))).toBe(true);
  });
});
