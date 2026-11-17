import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, completePersonalQuest, migrateState, xpForNextLevel, type ChronicleEntry, type GameState } from "./game";
import { addDaysToKey } from "./day-key";
import type { MissionData } from "./missions";
import type { Note, TradingPlan } from "./journal/types";
import type { PQLedgerEntry, PQRun } from "./personal-quests";

// QH-8.5: the XP of a completed personal path — variant C, once per run, in the same saved change as the result, the
// ledger, the level, the achievement and one chronicle entry. Never Coins; never for runs completed before QH-8.5.

const START = "2026-10-01";
const d = (i: number) => addDaysToKey(START, i);
const DAY31 = d(30);
const at = (day: string, hhmm = "10:00") => new Date(`${day}T${hhmm}:00.000Z`);
const REPORT = "Итог тридцати дней: что изменилось, что получилось, где сорвался и что делаю дальше — честно и по делу.";

const run = (id: string, hits: number, over: Partial<PQRun> = {}): PQRun => ({
  id, questId: `pqq_${id}`, category: "habits", verification: "self", title: id, goal: "g", dailyAction: "a", startState: "s", expectedResult: "e",
  startDay: START, createdAt: `${START}T08:00:00.000Z`, status: "active",
  marks: Array.from({ length: hits }, (_, i) => ({ day: d(i), savedOn: d(i), at: "", source: "self" as const })),
  ...over,
});
const state = (runs: PQRun[], extra: Partial<GameState> = {}): GameState =>
  ({ ...INITIAL_GAME_STATE, createdAt: "2026-09-01", lastQuestDate: d(29), xp: 0, coins: 75, level: 1, chronicle: [], profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" }, personalRuns: runs, ...extra }) as GameState;
/** XP counted across levels (the balance is xp within the current level). */
const totalXp = (s: Pick<GameState, "xp" | "level">) => {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += xpForNextLevel(lv);
  return sum;
};
const pathEntries = (c: ChronicleEntry[]) => c.filter((e) => typeof e === "object" && e.type === "personalPath");

// app days: a lesson note per confirmed day (learning accepts lessons)
const lesson = (i: number): Note => ({
  id: `l${i}`, templateKey: "lesson", body: `Урок ${i + 1}: жду закрытия свечи над уровнем и только потом вхожу по плану, без спешки и догадок.`,
  tags: [], pinned: false, createdAt: `${d(i)}T12:00:00.000Z`, updatedAt: `${d(i)}T12:00:00.000Z`, archivedAt: null,
});
const lessons = (n: number): MissionData => ({ plans: [], notes: Array.from({ length: n }, (_, i) => lesson(i)), trades: [], timezone: "UTC" });

describe("variant C: every rank, both ways of confirmation", () => {
  it.each([
    ["self", 20, null, 0],
    ["self", 21, "bronze", 50],
    ["self", 25, "silver", 90],
    ["self", 29, "gold", 125],
    ["app", 20, null, 0],
    ["app", 24, "bronze", 100],
    ["app", 28, "silver", 180],
    ["app", 30, "gold", 250],
  ] as const)("%s, %i days → %s, %i XP", (verification, days, rank, xp) => {
    const r = verification === "self" ? run("pq_v", days) : run("pq_v", 0, { verification: "app", category: "learning" });
    const s0 = state([r]);
    const res = completePersonalQuest(s0, "pq_v", REPORT, verification === "app" ? lessons(days) : null, at(DAY31));
    expect(res).toMatchObject({ ok: true, xp, result: { rank, days, verification } });
    expect(totalXp(res.state) - totalXp(s0)).toBe(xp);
    expect(res.state.coins).toBe(75);
    expect(res.state.personalLedger).toEqual([expect.objectContaining({ runId: "pq_v", xp, paid: true, rank })]);
  });

  it("nothing on day 30, nothing without a proper report", () => {
    const s0 = state([run("pq_d", 30)]);
    for (const [report, when] of [[REPORT, at(d(29))], ["", at(DAY31)], ["Коротко.", at(DAY31)]] as const) {
      const res = completePersonalQuest(s0, "pq_d", report, null, when);
      expect(res.ok).toBe(false);
      expect(res.xp).toBeUndefined();
      expect(totalXp(res.state)).toBe(totalXp(s0));
    }
  });
});

describe("once only — in one saved change", () => {
  it("result, paid ledger entry, XP, level, achievement and one chronicle entry come together; level-ups are written", () => {
    const s0 = state([run("pq_l", 30)], { level: 2, xp: xpForNextLevel(2) - 25 });
    const res = completePersonalQuest(s0, "pq_l", REPORT, null, at(DAY31));
    expect(res).toMatchObject({ xp: 125, leveledUp: true, newLevel: 3 });
    const s = res.state;
    expect(s.personalRuns![0]).toMatchObject({ status: "completed", result: { rank: "gold" } });
    expect(s.personalAchievements!.habits).toMatchObject({ rank: "gold", runId: "pq_l" });
    expect(pathEntries(s.chronicle)).toEqual([{ type: "personalPath", runId: "pq_l", category: "habits", rank: "gold", days: 30, xp: 125 }]);
    expect(s.chronicle.filter((e) => typeof e === "object" && e.type === "levelUp")).toHaveLength(1);
  });

  it("a second click, another tab or a reload pays nothing more and writes no second chronicle entry", () => {
    const s0 = state([run("pq_once", 26)]);
    const first = completePersonalQuest(s0, "pq_once", REPORT, null, at(DAY31));
    const again = completePersonalQuest(first.state, "pq_once", REPORT, null, at(DAY31, "10:01"));
    expect(again).toMatchObject({ ok: true, duplicate: true, xp: 0 });
    expect(totalXp(again.state)).toBe(totalXp(first.state));
    const reloaded = migrateState(JSON.parse(JSON.stringify(first.state)));
    expect(totalXp(reloaded)).toBe(totalXp(s0) + 90);
    expect(reloaded.level).toBe(first.state.level);
    const afterReload = completePersonalQuest(reloaded, "pq_once", REPORT, null, at(DAY31, "11:00"));
    expect(afterReload).toMatchObject({ duplicate: true, xp: 0 });
    expect(totalXp(afterReload.state)).toBe(totalXp(s0) + 90);
    expect(pathEntries(afterReload.state.chronicle)).toHaveLength(1);
    expect(afterReload.state.personalLedger).toHaveLength(1);
  });

  it("a new legitimate run of the same category pays again — even at a lower rank; the achievement keeps the best", () => {
    let s = completePersonalQuest(state([run("pq_g", 30)]), "pq_g", REPORT, null, at(DAY31)).state;
    const start2 = d(31);
    const second = run("pq_b", 0, { startDay: start2, createdAt: `${start2}T08:00:00.000Z` });
    second.marks = Array.from({ length: 22 }, (_, i) => ({ day: addDaysToKey(start2, i), savedOn: addDaysToKey(start2, i), at: "", source: "self" as const }));
    const before = totalXp(s);
    const res = completePersonalQuest({ ...s, personalRuns: [second, ...s.personalRuns!] }, "pq_b", REPORT, null, at(addDaysToKey(start2, 30)));
    s = res.state;
    expect(res.xp).toBe(50);
    expect(totalXp(s) - before).toBe(50);
    expect(s.personalAchievements!.habits).toMatchObject({ rank: "gold", runId: "pq_g" });
    expect(s.personalLedger!.map((e) => [e.runId, e.xp])).toEqual([["pq_g", 125], ["pq_b", 50]]);
  });
});

describe("runs completed before QH-8.5 (the QH-8.4 ledger)", () => {
  const oldEntry: PQLedgerEntry = { runId: "pq_old", questId: "pqq_pq_old", category: "habits", rank: "gold", days: 30, xp: 0, day: DAY31, at: `${DAY31}T09:00:00.000Z`, verification: "self" };
  const oldRun = run("pq_old", 30, { status: "completed", report: { at: `${DAY31}T09:00:00.000Z`, text: REPORT }, result: { rank: "gold", days: 30, day: DAY31, at: `${DAY31}T09:00:00.000Z`, verification: "self", marks: [] } });

  it("are recognised as completed without a reward and are never paid afterwards — after a migration and a reload", () => {
    const saved = state([oldRun], { personalLedger: [oldEntry], personalAchievements: { habits: { rank: "gold", runId: "pq_old", day: DAY31, verification: "self" } } });
    const m = migrateState(JSON.parse(JSON.stringify(saved)));
    expect(m.personalLedger).toEqual([expect.objectContaining({ runId: "pq_old", rank: "gold", xp: 0 })]);
    expect(m.personalLedger![0].paid).toBeUndefined();
    const res = completePersonalQuest(m, "pq_old", REPORT, null, at(addDaysToKey(DAY31, 2)));
    expect(res).toMatchObject({ ok: true, duplicate: true, xp: 0 });
    expect(totalXp(res.state)).toBe(totalXp(m));
    expect(pathEntries(res.state.chronicle)).toHaveLength(0); // no chronicle entry added for an old completion
    // a completed run with its ledger entry lost is not paid either
    const lost = completePersonalQuest({ ...m, personalLedger: [] }, "pq_old", REPORT, null, at(addDaysToKey(DAY31, 2)));
    expect(lost.ok).toBe(false);
    expect(totalXp(lost.state)).toBe(totalXp(m));
  });

  it("a paid entry is read back as paid; the stored XP number is never trusted (it follows the rank and the way of confirmation)", () => {
    const raw = {
      ...state([]),
      personalLedger: [
        { ...oldEntry, runId: "pq_p1", xp: 125, paid: true },
        { ...oldEntry, runId: "pq_p2", xp: 99999, paid: true }, // tampered number
        { ...oldEntry, runId: "pq_p3", xp: 500, paid: "yes" }, // not a paid mark
        { ...oldEntry, runId: "pq_p4", rank: null, xp: 300, paid: true },
        { ...oldEntry, runId: "pq_p5", verification: "app", rank: "silver", xp: 1, paid: true },
      ],
    };
    const m = migrateState(raw);
    expect(m.personalLedger!.map((e) => [e.runId, e.xp, e.paid ?? false])).toEqual([
      ["pq_p1", 125, true],
      ["pq_p2", 125, true],
      ["pq_p3", 0, false],
      ["pq_p4", 0, true],
      ["pq_p5", 180, true],
    ]);
    // reading the ledger never changes the balance
    expect([m.xp, m.level]).toEqual([raw.xp, raw.level]);
  });
});

describe("AYRA data: В-24 at payment, deleted records, completed runs", () => {
  const plan = (day: string, over: Partial<TradingPlan> = {}): TradingPlan => ({
    date: day, bias: [{ instrument: "EURUSD", direction: "bullish" } as never], levels: [{ instrument: "EURUSD", price: 1.1, label: "POI" } as never],
    events: [], checklist: [], createdAt: `${day}T07:00:00.000Z`, firstSavedAt: `${day}T07:00:00.000Z`, updatedAt: `${day}T07:00:00.000Z`, ...over,
  });
  const review = (i: number): Note => ({
    id: `rev${i}`, templateKey: "session_review", body: `Итог сессии ${i}: держался плана, вошёл только по сетапу, стоп не двигал; вывод — ждать подтверждения.`,
    tags: [], pinned: false, createdAt: `${d(i)}T18:00:00.000Z`, updatedAt: `${d(i)}T18:00:00.000Z`, archivedAt: null,
  });
  const days = Array.from({ length: 30 }, (_, i) => d(i));
  const app = (id: string, category: PQRun["category"], createdAt: string) => run(id, 0, { category, verification: "app", createdAt });

  it("two quests sharing day plans are paid for their own records only: discipline Silver 180 (3 plans deleted), trading Bronze 100", () => {
    const j: MissionData = { plans: days.map((x, i) => plan(x, i < 3 ? { deletedAt: `${x}T20:00:00.000Z` } : {})), notes: days.slice(0, 22).map((_, i) => review(i)), trades: [], timezone: "UTC" };
    const s0 = state([app("pq_disc", "discipline", `${START}T08:00:00.000Z`), app("pq_trad", "trading", `${START}T09:00:00.000Z`)]);
    const a = completePersonalQuest(s0, "pq_disc", REPORT, j, at(DAY31));
    const b = completePersonalQuest(a.state, "pq_trad", REPORT, j, at(DAY31, "10:05"));
    expect([a.result!.days, a.xp, b.result!.days, b.xp]).toEqual([27, 180, 22, 100]);
    expect(totalXp(b.state) - totalXp(s0)).toBe(280);
    // completing the first again after the Journal changed: nothing more, nothing recounted
    const again = completePersonalQuest(b.state, "pq_disc", REPORT, { plans: [], notes: [], trades: [], timezone: "UTC" }, at(DAY31, "11:00"));
    expect(again).toMatchObject({ duplicate: true, xp: 0, result: { days: 27 } });
  });
});
