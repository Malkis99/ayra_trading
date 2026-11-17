import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, checkAndApplyDateResets, completePersonalQuest, migrateState, type GameState } from "./game";
import { addDaysToKey } from "./day-key";
import type { MissionData } from "./missions";
import type { Note, TradingPlan } from "./journal/types";
import { allocateAppMarks, journeyOf } from "./personal-quest-days";
import type { PQRun } from "./personal-quests";

// QH-8.4: completing a personal quest — day 31+, the final report, the rank, the category achievement, the saved
// result. No XP, no Coins, no level change.

const START = "2026-10-01";
const d = (i: number) => addDaysToKey(START, i);
const END = d(29); // day 30
const DAY31 = d(30);
const at = (day: string, hhmm = "10:00") => new Date(`${day}T${hhmm}:00.000Z`);
const REPORT = "Итог тридцати дней: что изменилось, что получилось, где сорвался и что делаю дальше — честно и по делу.";

const selfRun = (id: string, hits: number, over: Partial<PQRun> = {}): PQRun => ({
  id,
  questId: `pqq_${id}`,
  category: "habits",
  verification: "self",
  title: `Квест ${id}`,
  goal: "g",
  dailyAction: "a",
  startState: "s",
  expectedResult: "e",
  startDay: START,
  createdAt: `${START}T08:00:00.000Z`,
  marks: Array.from({ length: hits }, (_, i) => ({ day: d(i), savedOn: d(i), at: `${d(i)}T19:00:00.000Z`, source: "self" as const })),
  status: "active",
  ...over,
});
const state = (runs: PQRun[], extra: Partial<GameState> = {}): GameState =>
  ({ ...INITIAL_GAME_STATE, createdAt: "2026-09-01", lastQuestDate: END, xp: 140, coins: 75, level: 4, profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" }, personalRuns: runs, ...extra }) as GameState;
const economy = (s: GameState) => ({ xp: s.xp, coins: s.coins, level: s.level, history: s.history, coinLog: s.coinLog, dailyStats: s.dailyStats });

describe("when a path can be completed", () => {
  it("not on day 30; from day 31, with a report of 80+ own characters", () => {
    const s = state([selfRun("pq_a", 30)]);
    expect(completePersonalQuest(s, "pq_a", REPORT, null, at(END)).reason).toBe("periodNotOver");
    expect(completePersonalQuest(s, "pq_a", "", null, at(DAY31)).reason).toBe("reportMissing");
    expect(completePersonalQuest(s, "pq_a", "Коротко о главном.", null, at(DAY31)).reason).toBe("reportShort");
    // spaces do not count as own text
    expect(completePersonalQuest(s, "pq_a", `${"а ".repeat(30)}${" ".repeat(60)}`, null, at(DAY31)).reason).toBe("reportShort");
    const ok = completePersonalQuest(s, "pq_a", REPORT, null, at(DAY31));
    expect(ok).toMatchObject({ ok: true, result: { rank: "gold", days: 30, day: DAY31 } });
  });

  it("an abandoned run gets no rank and no achievement", () => {
    const s = state([selfRun("pq_ab", 30, { status: "abandoned", abandonedAt: `${d(20)}T10:00:00.000Z` })]);
    const res = completePersonalQuest(s, "pq_ab", REPORT, null, at(DAY31));
    expect(res.reason).toBe("abandoned");
    expect(res.state.personalAchievements ?? {}).toEqual({});
  });

  it("Asia/Tbilisi: 20:30 UTC on day 30 is already day 31 there — completion opens by the account's game day", () => {
    const s = state([selfRun("pq_tb", 30)], { profile: { ...INITIAL_GAME_STATE.profile, timezone: "Asia/Tbilisi" } });
    expect(completePersonalQuest(s, "pq_tb", REPORT, null, at(END, "19:30")).reason).toBe("periodNotOver"); // 23:30 there
    expect(completePersonalQuest(s, "pq_tb", REPORT, null, at(END, "20:30")).result?.day).toBe(DAY31); // 00:30 there
  });
});

describe("the rank by confirmed days", () => {
  it.each([
    [20, null],
    [21, "bronze"],
    [24, "bronze"],
    [25, "silver"],
    [28, "silver"],
    [29, "gold"],
    [30, "gold"],
  ])("%i days → %s", (hits, rank) => {
    const res = completePersonalQuest(state([selfRun("pq_r", hits)]), "pq_r", REPORT, null, at(DAY31));
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ rank, days: hits, verification: "self" });
  });

  it("backfilled self marks never count (saved on another day)", () => {
    const run = selfRun("pq_bf", 20);
    run.marks.push({ day: d(25), savedOn: d(26), at: "", source: "self" });
    expect(completePersonalQuest(state([run]), "pq_bf", REPORT, null, at(DAY31)).result?.days).toBe(20);
  });
});

describe("once only, and no XP or Coins", () => {
  it("a second completion (another tab, a reload) returns the saved result: one ledger entry, one achievement", () => {
    const s0 = state([selfRun("pq_once", 26)]);
    const first = completePersonalQuest(s0, "pq_once", REPORT, null, at(DAY31));
    const second = completePersonalQuest(first.state, "pq_once", "Другой текст отчёта, который тоже длиннее восьмидесяти символов, но ничего не должен поменять.", null, at(DAY31, "11:00"));
    expect(second).toMatchObject({ ok: true, duplicate: true, result: first.result });
    expect(second.state.personalLedger).toHaveLength(1);
    expect(second.state.personalRuns![0].report!.text).toBe(REPORT);
    expect(second.state.personalAchievements).toEqual(first.state.personalAchievements);
    // after a reload (migration) the same
    const reloaded = migrateState(JSON.parse(JSON.stringify(second.state)));
    expect(completePersonalQuest(reloaded, "pq_once", REPORT, null, at(DAY31, "12:00"))).toMatchObject({ duplicate: true });
  });

  it("QH-8.5: the completion pays its XP once (self Gold 125); Coins, mission history, daily stats and the coin log stay", () => {
    const s0 = state([selfRun("pq_x", 30)]);
    const res = completePersonalQuest(s0, "pq_x", REPORT, null, at(DAY31));
    // the same as the day change alone does (day 31 starts at this first action of the day), apart from the XP
    const base = checkAndApplyDateResets(s0, at(DAY31));
    expect({ ...economy(res.state), xp: 0, level: 0 }).toEqual({ ...economy(base), xp: 0, level: 0 });
    // 140 + 125 = 265 XP at level 4: level 5 needs 80 + 40·4 = 240, so level 5 with 25
    expect([res.state.level, res.state.xp]).toEqual([5, 25]);
    expect(res).toMatchObject({ xp: 125, leveledUp: true, newLevel: 5 });
    expect(res.state.coins).toBe(75);
    expect(res.state.personalLedger![0]).toMatchObject({ runId: "pq_x", rank: "gold", xp: 125, paid: true });
  });
});

describe("category achievements", () => {
  it("raised Bronze → Gold, never lowered by Silver, never duplicated; the date and the way of confirmation kept", () => {
    let s = state([selfRun("pq_b1", 22)]);
    s = completePersonalQuest(s, "pq_b1", REPORT, null, at(DAY31)).state;
    expect(s.personalAchievements!.habits).toMatchObject({ rank: "bronze", runId: "pq_b1", day: DAY31, verification: "self" });
    // a later Gold run of the same category
    const start2 = d(31);
    const gold = selfRun("pq_g", 0, { startDay: start2, createdAt: `${start2}T08:00:00.000Z` });
    gold.marks = Array.from({ length: 30 }, (_, i) => ({ day: addDaysToKey(start2, i), savedOn: addDaysToKey(start2, i), at: "", source: "self" as const }));
    s = { ...s, personalRuns: [gold, ...s.personalRuns!] };
    const day61 = addDaysToKey(start2, 30);
    const up = completePersonalQuest(s, "pq_g", REPORT, null, at(day61));
    expect(up.upgraded).toBe(true);
    expect(up.state.personalAchievements!.habits).toMatchObject({ rank: "gold", runId: "pq_g" });
    // a Silver run afterwards keeps Gold
    const start3 = addDaysToKey(day61, 1);
    const silver = selfRun("pq_s", 0, { startDay: start3, createdAt: `${start3}T08:00:00.000Z` });
    silver.marks = Array.from({ length: 26 }, (_, i) => ({ day: addDaysToKey(start3, i), savedOn: addDaysToKey(start3, i), at: "", source: "self" as const }));
    const kept = completePersonalQuest({ ...up.state, personalRuns: [silver, ...up.state.personalRuns!] }, "pq_s", REPORT, null, at(addDaysToKey(start3, 30)));
    expect(kept.upgraded).toBe(false);
    expect(kept.state.personalAchievements!.habits).toMatchObject({ rank: "gold", runId: "pq_g" });
    expect(Object.keys(kept.state.personalAchievements!)).toEqual(["habits"]);
    expect(kept.state.personalLedger).toHaveLength(3);
  });

  it("no rank → no achievement", () => {
    const res = completePersonalQuest(state([selfRun("pq_n", 12)]), "pq_n", REPORT, null, at(DAY31));
    expect(res.result!.rank).toBeNull();
    expect(res.state.personalAchievements ?? {}).toEqual({});
  });
});

describe("AYRA data at completion (В-24 and the saved result)", () => {
  const plan = (day: string, over: Partial<TradingPlan> = {}): TradingPlan => ({
    date: day, bias: [{ instrument: "EURUSD", direction: "bullish" } as never], levels: [{ instrument: "EURUSD", price: 1.1, label: "POI" } as never],
    events: [], checklist: [], createdAt: `${day}T07:00:00.000Z`, firstSavedAt: `${day}T07:00:00.000Z`, updatedAt: `${day}T07:00:00.000Z`, ...over,
  });
  const review = (i: number): Note => ({
    id: `rev${i}`, templateKey: "session_review", body: `Итог сессии ${i}: держался плана, вошёл только по сетапу, стоп не двигал; вывод — ждать подтверждения.`,
    tags: [], pinned: false, createdAt: `${d(i)}T18:00:00.000Z`, updatedAt: `${d(i)}T18:00:00.000Z`, archivedAt: null,
  });
  const days = Array.from({ length: 30 }, (_, i) => d(i));
  const journal = (over: Partial<MissionData> = {}): MissionData => ({ plans: days.map((x) => plan(x)), notes: days.slice(0, 22).map((_, i) => review(i)), trades: [], timezone: "UTC", ...over });
  const appRun = (id: string, category: PQRun["category"], createdAt: string): PQRun => ({ ...selfRun(id, 0), category, verification: "app", createdAt, marks: [] });
  const disc = appRun("pq_disc", "discipline", `${START}T08:00:00.000Z`);
  const trad = appRun("pq_trad", "trading", `${START}T09:00:00.000Z`);

  it("the Journal must be read: while it is not, completion waits", () => {
    expect(completePersonalQuest(state([disc]), "pq_disc", REPORT, null, at(DAY31)).reason).toBe("journalPending");
  });

  it("two quests sharing day plans: one record counts once — 30 plans + 22 reviews give 52 days in all, never 60", () => {
    const j = journal();
    let s = state([disc, trad]);
    const a = completePersonalQuest(s, "pq_disc", REPORT, j, at(DAY31));
    s = a.state;
    const b = completePersonalQuest(s, "pq_trad", REPORT, j, at(DAY31, "10:05"));
    expect(a.result!.days + b.result!.days).toBe(52);
    expect(a.result).toMatchObject({ rank: "gold", days: 30 });
    expect(b.result).toMatchObject({ rank: "bronze", days: 22 });
    const keys = [...a.result!.marks, ...b.result!.marks].map((m) => m.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    // the other order of completion gives the same results
    const c = completePersonalQuest(state([disc, trad]), "pq_trad", REPORT, j, at(DAY31));
    const e = completePersonalQuest(c.state, "pq_disc", REPORT, j, at(DAY31, "10:05"));
    expect([e.result!.days, c.result!.days]).toEqual([30, 22]);
  });

  it("a record deleted before completion no longer counts; one deleted after completion changes nothing", () => {
    const j = journal({ plans: days.map((x, i) => (i < 3 ? plan(x, { deletedAt: `${x}T20:00:00.000Z` }) : plan(x))) });
    const res = completePersonalQuest(state([disc]), "pq_disc", REPORT, j, at(DAY31));
    expect(res.result).toMatchObject({ days: 27, rank: "silver" });
    // after completion the Journal changes: the saved result stays, and its records stay reserved
    const emptied: MissionData = { plans: [], notes: [], trades: [], timezone: "UTC" };
    const run = res.state.personalRuns![0];
    expect(journeyOf(run, DAY31, emptied).confirmed).toBe(27);
    expect(journeyOf(run, DAY31, null).pending).toBe(false);
    const other = appRun("pq_other", "trading", `${START}T09:00:00.000Z`);
    const alloc = allocateAppMarks([run, other], j, DAY31);
    const reserved = new Set(run.result!.marks.map((m) => m.sourceKey));
    expect(alloc.marks.get("pq_other")!.some((m) => reserved.has(m.sourceKey))).toBe(false);
  });

  it("a stored sourceKey alone proves nothing: forged app marks in the run are ignored", () => {
    const forged = { ...disc, marks: days.map((x) => ({ day: x, savedOn: x, at: "", source: "app" as const, sourceKey: `note:fake-${x}` })) };
    const res = completePersonalQuest(state([forged]), "pq_disc", REPORT, { plans: [], notes: [], trades: [], timezone: "UTC" }, at(DAY31));
    expect(res.result).toMatchObject({ days: 0, rank: null });
  });
});

describe("old saves", () => {
  it("a save without the ledger or achievements gets empty ones; damaged entries are dropped", () => {
    const m = migrateState({ ...state([]), personalLedger: undefined, personalAchievements: undefined });
    expect(m.personalLedger).toEqual([]);
    expect(m.personalAchievements).toEqual({});
    const bad = migrateState({
      ...state([]),
      personalLedger: [null, { runId: "r1", category: "nope" }, { runId: "r2", category: "habits", rank: "gold", days: 30, xp: 999, day: DAY31, at: "", verification: "self" }],
      personalAchievements: { habits: { rank: "gold", runId: "r2", day: DAY31, verification: "self" }, nope: { rank: "gold" }, learning: { rank: "platinum", runId: "x", day: DAY31 } },
    });
    expect(bad.personalLedger).toEqual([expect.objectContaining({ runId: "r2", rank: "gold", xp: 0 })]);
    expect(Object.keys(bad.personalAchievements!)).toEqual(["habits"]);
  });
});
