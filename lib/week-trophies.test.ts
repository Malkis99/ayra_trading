import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, checkAndApplyDateResets, completeSelfReportQuest, migrateState, recordWeekBossResult, setWeekChallenge, type GameState } from "./game";
import { challengeDays, closedPhase, currentPhase, readWeekTrophies, trophiesFromWeeks, trophyFor, weekMinutesLeft, withWeekTrophy } from "./week-trophies";
import type { JournalSnapshot } from "./quest-engine";
import type { WeekSnapshot } from "./day-snapshots";

// QH-7: a won week leaves one lasting trophy; nothing gives XP or Coins; weeks follow the account zone.

const at = (iso: string) => new Date(iso);
const noon = (day: string) => at(`${day}T12:00:00Z`);
function started(day: string, zone = "UTC"): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: zone } } as GameState;
  return checkAndApplyDateResets(base, at(`${day}T06:00:00Z`));
}
const totalXp = (s: GameState) => {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += 80 + lv * 40;
  return sum;
};
const wealth = (s: GameState) => ({ xp: totalXp(s), level: s.level, coins: s.coins, achievements: { ...s.achievements }, history: s.history.length, coinLog: (s.coinLog || []).length });
const met = { state: "met" as const, conditions: [{ key: "stopSet", source: "auto" as const, state: "met" as const, done: 3, total: 3 }, { key: "stopNotMoved", source: "self" as const, state: "met" as const, done: 3, total: 3 }], at: "2026-11-16T09:00:00.000Z" };
const notMet = { ...met, state: "notMet" as const };

/** A week with its challenge, closed by the next Monday. */
function closedWeek(zone = "UTC"): GameState {
  let s = started("2026-11-09", zone);
  s = setWeekChallenge(s, { week: "2026-11-09", boss: "respectStop" });
  for (const id of [...(s.questDay?.core || []), ...(s.questDay?.bonus || [])]) {
    const r = completeSelfReportQuest(s, id, id, "Mental", 30, at("2026-11-09T09:00:00Z"));
    if (r.state.completedQuestsToday[id]) {
      s = r.state;
      break;
    }
  }
  return checkAndApplyDateResets(s, noon("2026-11-16"));
}

describe("a won week leaves one trophy", () => {
  it("a «met» result writes the trophy and a story entry in the same write; XP, Coins, level, achievements unchanged", () => {
    let s = closedWeek();
    const before = wealth(s);
    s = recordWeekBossResult(s, "2026-11-09", met, noon("2026-11-16"));
    expect(s.weekTrophies).toEqual([{ v: 1, week: "2026-11-09", boss: "respectStop", at: met.at, conditions: [{ key: "stopSet", source: "auto", done: 3, total: 3 }, { key: "stopNotMoved", source: "self", done: 3, total: 3 }] }]);
    expect(s.chronicle[0]).toEqual({ type: "weekTrophy", boss: "respectStop", week: "2026-11-09" });
    expect(wealth(s)).toEqual(before);
  });

  it("a repeated check, another result or a reload add no second trophy", () => {
    let s = recordWeekBossResult(closedWeek(), "2026-11-09", met, noon("2026-11-16"));
    const once = s;
    s = recordWeekBossResult(s, "2026-11-09", met, noon("2026-11-16"));
    s = recordWeekBossResult(s, "2026-11-09", notMet, noon("2026-11-17"));
    expect({ weeks: s.questWeeks, trophies: s.weekTrophies, chronicle: s.chronicle }).toEqual({ weeks: once.questWeeks, trophies: once.weekTrophies, chronicle: once.chronicle });
    const reloaded = migrateState(JSON.parse(JSON.stringify(s)));
    expect(reloaded.weekTrophies).toHaveLength(1);
    expect(reloaded.chronicle.filter((c) => typeof c === "object" && c.type === "weekTrophy")).toHaveLength(1);
  });

  it("«not met» and «not applicable» weeks get no trophy (no penalty either)", () => {
    const before = wealth(closedWeek());
    for (const r of [notMet, { ...met, state: "notApplicable" as const }]) {
      const s = recordWeekBossResult(closedWeek(), "2026-11-09", r, noon("2026-11-16"));
      expect(s.weekTrophies || []).toEqual([]);
      expect(wealth(s)).toEqual(before);
    }
  });

  it("two tabs: the second write starts from the stored state the first one saved, and adds nothing", () => {
    // the store gives every change the freshest saved state (lib/game-store.ts); on it the change is a no-op
    const s0 = closedWeek();
    const a = recordWeekBossResult(s0, "2026-11-09", met, noon("2026-11-16"));
    const b = recordWeekBossResult(a, "2026-11-09", met, at("2026-11-16T12:00:05Z"));
    expect(b.weekTrophies).toHaveLength(1);
  });

  it("the current week never gets a result or a trophy before it ends", () => {
    const s = closedWeek();
    expect(recordWeekBossResult(s, "2026-11-16", met, noon("2026-11-16")).weekTrophies || []).toEqual([]);
  });
});

describe("existing saves", () => {
  it("a win already written in a kept week snapshot gets its trophy on load (the recorded result, not recomputed)", () => {
    const old = closedWeek();
    const raw = JSON.parse(JSON.stringify({ ...old, questWeeks: old.questWeeks!.map((w) => ({ ...w, bossResult: met })), weekTrophies: undefined }));
    const s = migrateState(raw);
    expect(s.weekTrophies!.map((t) => [t.week, t.boss, t.at])).toEqual([["2026-11-09", "respectStop", met.at]]);
    // its history is not touched and no story entry is invented for it
    expect(s.questWeeks).toEqual(old.questWeeks!.map((w) => ({ ...w, bossResult: met })));
    expect(s.chronicle.some((c) => typeof c === "object" && c.type === "weekTrophy")).toBe(false);
    expect(wealth(s)).toEqual(wealth(migrateState(JSON.parse(JSON.stringify(old)))));
  });

  it("a week without a written result, without a challenge or not met gets nothing; damaged trophies are dropped", () => {
    const weeks: WeekSnapshot[] = [
      { v: 1, week: "2026-11-02", boss: "noFomo", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: "x" },
      { v: 1, week: "2026-10-26", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: "x" },
      { v: 1, week: "2026-10-19", boss: "patience", bossResult: notMet, daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: "x" },
    ];
    expect(trophiesFromWeeks([], weeks)).toEqual([]);
    expect(readWeekTrophies([null, 5, { week: "bad" }, { week: "2026-11-02", boss: "noFomo", at: "t", conditions: [] }, { week: "2026-11-02", boss: "x", at: "t", conditions: [] }])).toHaveLength(1);
    expect(readWeekTrophies("nope")).toEqual([]);
  });

  it("an old save without trophies or week snapshots loads as before", () => {
    const s = migrateState({ name: "Old", xp: 10, level: 1, coins: 5, chronicle: [], achievements: {} });
    expect(s.weekTrophies).toEqual([]);
  });

  it("one trophy per week; newest first", () => {
    let list = withWeekTrophy([], trophyFor("2026-11-02", "noFomo", met))!;
    list = withWeekTrophy(list, trophyFor("2026-11-09", "respectStop", met))!;
    expect(list.map((t) => t.week)).toEqual(["2026-11-09", "2026-11-02"]);
    expect(withWeekTrophy(list, trophyFor("2026-11-09", "patience", met))).toBeNull();
    expect(trophyFor("2026-11-09", "patience", notMet)).toBeNull();
  });
});

describe("the week cycle: phases, days, time left", () => {
  it("phases of the current and of a closed week", () => {
    expect(currentPhase("met")).toBe("conditionMet");
    for (const s of ["notMet", "notApplicable", "insufficientData", "pending"] as const) expect(currentPhase(s)).toBe("active");
    const w: WeekSnapshot = { v: 1, week: "2026-11-09", boss: "noFomo", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: "x" };
    expect(closedPhase(undefined)).toBe("none");
    expect(closedPhase({ ...w, boss: undefined })).toBe("none");
    expect(closedPhase(w)).toBe("checking");
    expect(closedPhase({ ...w, bossResult: met })).toBe("completed");
    expect(closedPhase({ ...w, bossResult: notMet })).toBe("notCompleted");
    expect(closedPhase({ ...w, bossResult: { ...met, state: "notApplicable" } })).toBe("notApplicable");
  });

  const trade = (id: string, openedAt: string, extra: Record<string, unknown> = {}) => ({ id, accountId: "a", instrument: "EURUSD", direction: "long", status: "closed", openedAt, mistakes: [], emotions: [], stopLoss: 1.08, ...extra });

  it("each day by the challenge on that day's trades; a day without trades is «no trades», never a failure", () => {
    const snap = {
      trades: [trade("t1", "2026-11-09T09:00:00Z"), trade("t2", "2026-11-10T09:00:00Z", { mistakes: ["moved_stop"] }), trade("t3", "2026-11-10T10:00:00Z", { deletedAt: "2026-11-10T11:00:00Z", mistakes: ["moved_stop"] })],
      plans: [],
      weekPlans: [],
      noTrades: [],
      timezone: "UTC",
    } as unknown as JournalSnapshot;
    const days = challengeDays("respectStop", snap, "2026-11-09", "2026-11-12");
    expect(days.map((d) => d.state)).toEqual(["met", "notMet", "noTrades", "noTrades", "future", "future", "future"]);
    expect(days[1].trades).toBe(1); // the deleted trade is not counted
  });

  it("a trade late on Sunday in Tbilisi belongs to Sunday there, to Monday's week nowhere else", () => {
    // 2026-11-15 21:30 UTC = Monday 01:30 in Tbilisi
    const snap = (tz: string) => ({ trades: [trade("t1", "2026-11-15T21:30:00Z")], plans: [], weekPlans: [], noTrades: [], timezone: tz }) as unknown as JournalSnapshot;
    expect(challengeDays("respectStop", snap("UTC"), "2026-11-09", "2026-11-15")[6]).toMatchObject({ key: "2026-11-15", state: "met" });
    expect(challengeDays("respectStop", snap("Asia/Tbilisi"), "2026-11-09", "2026-11-15")[6]).toMatchObject({ key: "2026-11-15", state: "noTrades" });
    expect(challengeDays("respectStop", snap("Asia/Tbilisi"), "2026-11-16", "2026-11-16")[0]).toMatchObject({ key: "2026-11-16", state: "met" });
  });

  it("time left until Monday 00:00 in the account zone: Sunday → Monday, a month end, a year end, UTC and Tbilisi", () => {
    // Sunday 23:50 → 10 minutes
    expect(weekMinutesLeft(at("2026-11-15T23:50:00Z"), "2026-11-15", "UTC")).toBe(10);
    expect(weekMinutesLeft(at("2026-11-15T19:50:00Z"), "2026-11-15", "Asia/Tbilisi")).toBe(10);
    // Monday 00:05 → a full week less 5 minutes
    expect(weekMinutesLeft(at("2026-11-16T00:05:00Z"), "2026-11-16", "UTC")).toBe(7 * 1440 - 5);
    expect(weekMinutesLeft(at("2026-11-15T20:05:00Z"), "2026-11-16", "Asia/Tbilisi")).toBe(7 * 1440 - 5);
    // a week across a month end (Mon 30 Nov … Sun 6 Dec): Tuesday 1 Dec 12:00 → 5 days 12 h
    expect(weekMinutesLeft(at("2026-12-01T12:00:00Z"), "2026-12-01", "UTC")).toBe(5 * 1440 + 720);
    // a week across a year end (Mon 28 Dec … Sun 3 Jan): Friday 1 Jan 00:00 in Tbilisi → 3 days
    expect(weekMinutesLeft(at("2026-12-31T20:00:00Z"), "2027-01-01", "Asia/Tbilisi")).toBe(3 * 1440);
  });
});
