import { describe, it, expect } from "vitest";
import { bossConditions, bossState, chooseWeekPath, closedBossResult, currentBoss, prepActiveDay, prepWeekSummary, type JournalSnapshot } from "./quest-engine";
import { INITIAL_GAME_STATE, checkAndApplyDateResets, migrateState, recordWeekBossResult, setDayMode, setWeekChallenge, type GameState } from "./game";
import { challengeDays } from "./week-trophies";

// QH-7.1 «Preparation week» (owner decision В-17): 3 different game days with confirmed journal work + a saved week
// summary; by the Quest Hub checks; chosen once before the week counts; one trophy, no XP or Coins.

const WEEK = "2026-11-16"; // Monday
const TEXT = "Урок недели: вход только после закрытия свечи за уровнем, без догоняющих входов по рынку.";
let n = 0;
const note = (templateKey: string, createdAt: string, body = `${TEXT} #${++n}`, extra: Record<string, unknown> = {}) => ({ id: `n${++n}`, templateKey, title: "", body, tags: [], pinned: false, createdAt, updatedAt: createdAt, archivedAt: null, ...extra });
const plan = (date: string, at: string) => ({ date, bias: [{ instrument: "EURUSD", direction: "bullish" }], levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }], events: [], checklist: [], createdAt: at, firstSavedAt: at, updatedAt: at });
const summary = (text = "Неделя: три урока по входам, один план, вывод — ждать подтверждения уровня.", updatedAt = `${WEEK}T09:00:00.000Z`) => ({ weekStartDate: WEEK, goals: [], summary: text, createdAt: `${WEEK}T08:00:00.000Z`, updatedAt });
const snap = (over: Partial<JournalSnapshot> = {}): JournalSnapshot => ({ trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], timezone: "UTC", ...over }) as JournalSnapshot;
const trade = (id: string, openedAt: string) => ({ id, accountId: "a", instrument: "EURUSD", direction: "long", status: "closed", openedAt, mistakes: [], emotions: [] });

describe("an active day: confirmed journal work by the Quest Hub checks", () => {
  it("a lesson, a review note, an observation or a day plan made that day counts", () => {
    expect(prepActiveDay(snap({ notes: [note("lesson", `${WEEK}T10:00:00.000Z`)] as never }), WEEK)).toBe(true);
    expect(prepActiveDay(snap({ notes: [note("idea", `${WEEK}T10:00:00.000Z`)] as never }), WEEK)).toBe(true);
    expect(prepActiveDay(snap({ notes: [note("session_review", `${WEEK}T10:00:00.000Z`)] as never }), WEEK)).toBe(true);
    expect(prepActiveDay(snap({ plans: [plan(WEEK, `${WEEK}T07:00:00.000Z`)] as never }), WEEK)).toBe(true);
  });

  it("nothing on the day, a too short text, an imported note, a copy or a note of another day does not count", () => {
    expect(prepActiveDay(snap(), WEEK)).toBe(false);
    expect(prepActiveDay(snap({ notes: [note("lesson", `${WEEK}T10:00:00.000Z`, "коротко")] as never }), WEEK)).toBe(false);
    expect(prepActiveDay(snap({ notes: [note("lesson", `${WEEK}T10:00:00.000Z`, undefined, { importBatchId: "imp1" })] as never }), WEEK)).toBe(false);
    const first = note("lesson", "2026-11-10T10:00:00.000Z", TEXT);
    expect(prepActiveDay(snap({ notes: [first, note("lesson", `${WEEK}T10:00:00.000Z`, TEXT)] as never }), WEEK)).toBe(false);
    expect(prepActiveDay(snap({ notes: [note("lesson", "2026-11-17T10:00:00.000Z")] as never }), WEEK)).toBe(false);
  });

  it("the day state alone (a rating and an emotion, no text) is not substantive work", () => {
    const p = { date: WEEK, bias: [], levels: [], events: [], checklist: [], createdAt: `${WEEK}T07:00:00.000Z`, review: { rating: 4, emotions: ["calm"], completedAt: `${WEEK}T20:00:00.000Z` } };
    expect(prepActiveDay(snap({ plans: [p] as never }), WEEK)).toBe(false);
  });

  it("three records on one day are one active day", () => {
    const s = snap({ notes: [note("lesson", `${WEEK}T09:00:00.000Z`), note("idea", `${WEEK}T10:00:00.000Z`), note("session_review", `${WEEK}T11:00:00.000Z`)] as never, weekPlans: [summary()] });
    const c = bossConditions("preparationWeek", s, "2026-11-22");
    expect(c.find((x) => x.key === "activeDays")).toMatchObject({ done: 1, total: 3, state: "pending" });
  });
});

describe("the week summary", () => {
  it("own text of 40+ characters saved within the week", () => {
    expect(prepWeekSummary(snap({ weekPlans: [summary()] }), WEEK)).toBe(true);
    expect(prepWeekSummary(snap({ weekPlans: [summary("Неделя норм.")] }), WEEK)).toBe(false);
    expect(prepWeekSummary(snap({ weekPlans: [{ ...summary(), deletedAt: "2026-11-18T00:00:00.000Z" }] }), WEEK)).toBe(false);
    // written only after the week ended (Monday of the next week) — not the week's summary
    expect(prepWeekSummary(snap({ weekPlans: [summary(undefined, "2026-11-23T08:00:00.000Z")] }), WEEK)).toBe(false);
  });

  // review of #190: a summary counts only with a confirmed save time inside the week
  it("a missing save time does not confirm the summary", () => {
    expect(prepWeekSummary(snap({ weekPlans: [{ ...summary(), updatedAt: undefined }] }), WEEK)).toBe(false);
    expect(prepWeekSummary(snap({ weekPlans: [{ ...summary(), updatedAt: "" }] }), WEEK)).toBe(false);
  });

  it("a broken timestamp does not confirm the summary", () => {
    for (const bad of ["not a date", "2026-13-45T99:00:00Z", "yesterday"]) {
      expect(prepWeekSummary(snap({ weekPlans: [{ ...summary(), updatedAt: bad }] }), WEEK)).toBe(false);
    }
  });

  it("saved before Sunday ends (account zone) counts; saved on Monday does not — UTC and Tbilisi", () => {
    expect(prepWeekSummary(snap({ weekPlans: [summary(undefined, "2026-11-22T23:59:00.000Z")] }), WEEK)).toBe(true);
    expect(prepWeekSummary(snap({ weekPlans: [summary(undefined, "2026-11-23T00:01:00.000Z")] }), WEEK)).toBe(false);
    // Tbilisi: Sunday 23:59 = 19:59 UTC; Monday 00:01 = Sunday 20:01 UTC
    expect(prepWeekSummary(snap({ timezone: "Asia/Tbilisi", weekPlans: [summary(undefined, "2026-11-22T19:59:00.000Z")] }), WEEK)).toBe(true);
    expect(prepWeekSummary(snap({ timezone: "Asia/Tbilisi", weekPlans: [summary(undefined, "2026-11-22T20:01:00.000Z")] }), WEEK)).toBe(false);
  });

  it("a closed week whose summary has no confirmed time is «not met» — no new trophy", () => {
    const s = snap({ notes: [WEEK, "2026-11-18", "2026-11-21"].map((d) => note("lesson", `${d}T10:00:00.000Z`)) as never, weekPlans: [{ ...summary(), updatedAt: undefined }] });
    const r = closedBossResult("preparationWeek", s, WEEK);
    expect(r.state).toBe("notMet");
    expect(r.conditions.find((c) => c.key === "weekSummary")).toMatchObject({ state: "notMet" });
  });
});

describe("the result", () => {
  const days = (keys: string[]) => keys.map((d) => note("lesson", `${d}T10:00:00.000Z`));

  it("3 different days + a summary → met; during the week «in progress» until then", () => {
    const won = snap({ notes: days([WEEK, "2026-11-18", "2026-11-21"]) as never, weekPlans: [summary()] });
    expect(bossState(bossConditions("preparationWeek", won, "2026-11-21"))).toBe("met");
    expect(closedBossResult("preparationWeek", won, WEEK).state).toBe("met");
    const partial = snap({ notes: days([WEEK, "2026-11-18"]) as never, weekPlans: [summary()] });
    expect(bossState(bossConditions("preparationWeek", partial, "2026-11-18"))).toBe("pending");
  });

  it("a closed week: what was still pending is «not met» (no summary, or two days only)", () => {
    const noSummary = snap({ notes: days([WEEK, "2026-11-18", "2026-11-21"]) as never });
    expect(closedBossResult("preparationWeek", noSummary, WEEK)).toMatchObject({ state: "notMet" });
    const twoDays = snap({ notes: days([WEEK, "2026-11-18"]) as never, weekPlans: [summary()] });
    const r = closedBossResult("preparationWeek", twoDays, WEEK);
    expect(r.state).toBe("notMet");
    expect(r.conditions.find((c) => c.key === "activeDays")).toMatchObject({ state: "notMet", done: 2, total: 3 });
  });

  it("the week edge in the account zone: Sunday 23:30 in Tbilisi is this week; Monday 00:10 there is the next one", () => {
    const s = (tz: string) =>
      snap({ timezone: tz, weekPlans: [summary()], notes: [note("lesson", "2026-11-16T10:00:00.000Z"), note("lesson", "2026-11-18T10:00:00.000Z"), note("lesson", "2026-11-22T19:30:00.000Z")] as never });
    expect(closedBossResult("preparationWeek", s("Asia/Tbilisi"), WEEK).state).toBe("met");
    const late = snap({ timezone: "Asia/Tbilisi", weekPlans: [summary()], notes: [note("lesson", "2026-11-16T10:00:00.000Z"), note("lesson", "2026-11-18T10:00:00.000Z"), note("lesson", "2026-11-22T20:10:00.000Z")] as never });
    expect(closedBossResult("preparationWeek", late, WEEK).state).toBe("notMet");
    expect(challengeDays("preparationWeek", s("Asia/Tbilisi"), WEEK, "2026-11-22").map((d) => d.state)).toEqual(["met", "noTrades", "met", "noTrades", "noTrades", "noTrades", "met"]);
  });

  it("trading challenges are unchanged: their conditions are never «pending»", () => {
    const s = snap({ trades: [trade("t1", `${WEEK}T09:00:00.000Z`)] as never });
    for (const boss of ["noFomo", "respectStop", "riskGuardian", "followPlan", "patience", "journalConsistency"] as const) {
      const c = bossConditions(boss, s, WEEK);
      expect(c.every((x) => x.state !== "pending")).toBe(true);
      expect(closedBossResult(boss, s, WEEK)).toEqual({ state: bossState(c), conditions: c });
    }
  });
});

describe("choosing the week's path", () => {
  it("last week's trades → the trading challenge; trades already this week → the same; otherwise «Preparation week»", () => {
    expect(chooseWeekPath(snap({ trades: [trade("t1", "2026-11-10T09:00:00.000Z")] as never }), "2026-11-18")).not.toBe("preparationWeek");
    expect(chooseWeekPath(snap({ trades: [trade("t1", `${WEEK}T09:00:00.000Z`)] as never }), "2026-11-18")).toBe("journalConsistency");
    expect(chooseWeekPath(snap(), "2026-11-18")).toBe("preparationWeek");
  });

  it("a saved path is never replaced: a saved trading challenge stays in a week without trades, and the other way", () => {
    expect(currentBoss({ week: WEEK, boss: "respectStop" }, snap(), "2026-11-18")).toBe("respectStop");
    expect(currentBoss({ week: WEEK, boss: "preparationWeek" }, snap({ trades: [trade("t1", `${WEEK}T09:00:00.000Z`)] as never }), "2026-11-18")).toBe("preparationWeek");
  });
});

describe("earlier confirmed wins are kept (review of #190)", () => {
  it("a week already recorded as won keeps its result and trophy: nothing is recomputed, on load or by a new check", () => {
    const started = checkAndApplyDateResets({ ...INITIAL_GAME_STATE, createdAt: "2026-10-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" } } as GameState, new Date(`${WEEK}T06:00:00Z`));
    let s = setWeekChallenge(started, { week: WEEK, boss: "preparationWeek" });
    s = checkAndApplyDateResets(s, new Date("2026-11-23T07:00:00Z"));
    const won = { state: "met" as const, conditions: [{ key: "activeDays", source: "auto" as const, state: "met" as const, done: 3, total: 3 }, { key: "weekSummary", source: "auto" as const, state: "met" as const, done: 1, total: 1 }], at: "2026-11-23T07:05:00.000Z" };
    s = recordWeekBossResult(s, WEEK, won, new Date("2026-11-23T07:05:00Z"));
    // the journal today has a summary without a save time (stricter rule): a new check gives «not met», but the result stays
    const strict = closedBossResult("preparationWeek", snap({ weekPlans: [{ ...summary(), updatedAt: undefined }] }), WEEK);
    expect(strict.state).toBe("notMet");
    const after = recordWeekBossResult(s, WEEK, { ...strict, at: "2026-11-23T08:00:00.000Z" }, new Date("2026-11-23T08:00:00Z"));
    expect(after.questWeeks![0].bossResult).toEqual(won);
    expect(after.weekTrophies!.map((t) => [t.week, t.boss, t.at])).toEqual([[WEEK, "preparationWeek", won.at]]);
    const reloaded = migrateState(JSON.parse(JSON.stringify(after)));
    expect(reloaded.questWeeks![0].bossResult).toEqual(won);
    expect(reloaded.weekTrophies).toHaveLength(1);
  });
});

describe("the game: one attempt, one trophy, no XP or Coins", () => {
  const at = (iso: string) => new Date(iso);
  const started = (day: string): GameState =>
    checkAndApplyDateResets({ ...INITIAL_GAME_STATE, createdAt: "2026-10-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" } } as GameState, at(`${day}T06:00:00Z`));

  it("the saved path survives mode changes; a won week gives one trophy; a second result or a second tab adds nothing", () => {
    let s = started(WEEK);
    s = setWeekChallenge(s, { week: WEEK, boss: "preparationWeek" });
    s = setDayMode(s, "study", at(`${WEEK}T08:00:00Z`)).state;
    s = setDayMode(s, "recovery", at(`${WEEK}T09:00:00Z`)).state;
    // a second choice in the same week is ignored
    s = setWeekChallenge(s, { week: WEEK, boss: "respectStop" });
    expect(s.questWeek).toEqual({ week: WEEK, boss: "preparationWeek" });
    s = checkAndApplyDateResets(s, at("2026-11-23T07:00:00Z"));
    expect(s.questWeeks![0]).toMatchObject({ week: WEEK, boss: "preparationWeek" });
    const before = { xp: s.xp, level: s.level, coins: s.coins, achievements: { ...s.achievements } };
    const result = { state: "met" as const, conditions: [{ key: "activeDays", source: "auto" as const, state: "met" as const, done: 3, total: 3 }, { key: "weekSummary", source: "auto" as const, state: "met" as const, done: 1, total: 1 }], at: "2026-11-23T07:05:00.000Z" };
    s = recordWeekBossResult(s, WEEK, result, at("2026-11-23T07:05:00Z"));
    s = recordWeekBossResult(s, WEEK, result, at("2026-11-23T07:05:02Z"));
    s = recordWeekBossResult(s, WEEK, { ...result, state: "notMet" }, at("2026-11-23T08:00:00Z"));
    expect(s.weekTrophies!.map((t) => [t.week, t.boss])).toEqual([[WEEK, "preparationWeek"]]);
    expect({ xp: s.xp, level: s.level, coins: s.coins, achievements: s.achievements }).toEqual(before);
  });
});
