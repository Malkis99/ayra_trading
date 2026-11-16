import { describe, it, expect } from "vitest";
import { addDaysToKey } from "./day-key";
import {
  NO_RECORDS,
  PQ_CATEGORIES,
  PQ_MAX_ACTIVE,
  PQ_RANK_XP,
  canStart,
  confirmedDays,
  endDayOf,
  phaseOf,
  rankFor,
  settleRun,
  withAchievement,
  type PQCategoryId,
  type PQLedgerEntry,
  type PQRecordCheck,
  type PQRun,
} from "./personal-quests";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";

// QH-8.1: the personal quest model (not wired to the game; no XP is given anywhere).

const START = "2026-11-16";
const REPORT = "Итог тридцати дней: что изменилось, что получилось, где сорвался и что делаю дальше — честно и по делу.";
/** The records really saved in the Journal (key → the game day saved): what QH-8.3 checks marks against. */
const journal = new Map<string, string>();
const check: PQRecordCheck = (mark) => !!mark.sourceKey && journal.get(mark.sourceKey) === mark.day;
let seq = 0;
function run(over: Partial<PQRun> = {}, hits = 0): PQRun {
  const r: PQRun = { id: `r${++seq}`, questId: "q1", category: "learning", title: "Урок в день", goal: "Учиться", dailyAction: "Один урок", startState: "", expectedResult: "", verification: "app", startDay: START, marks: [], status: "active", ...over };
  for (let i = 0; i < hits; i++) {
    const day = addDaysToKey(r.startDay, i);
    const sourceKey = r.verification === "app" ? `note:${r.id}:${i}` : undefined;
    if (sourceKey) journal.set(sourceKey, day);
    r.marks.push({ day, at: `${day}T19:00:00.000Z`, savedOn: day, source: r.verification, sourceKey });
  }
  return r;
}
const after = (r: PQRun) => addDaysToKey(endDayOf(r), 1);

describe("ranks by confirmed days", () => {
  it("21–24 Bronze, 25–28 Silver, 29–30 Gold, fewer than 21 — no rank", () => {
    expect([0, 20, 21, 24, 25, 28, 29, 30].map(rankFor)).toEqual([null, null, "bronze", "bronze", "silver", "silver", "gold", "gold"]);
  });
});

describe("confirmed days are honest", () => {
  it("one per day; outside the period, backfilled (В-21) or wrong-source marks do not count", () => {
    const r = run({}, 10);
    const d = (i: number) => addDaysToKey(START, i);
    const k = (name: string, day: string) => (journal.set(name, day), name);
    r.marks.push({ day: d(0), at: "x", savedOn: d(0), source: "app", sourceKey: k("note:again", d(0)) }); // the same day again
    // a note about yesterday is kept in the diary, but it is not a confirmed daily action
    r.marks.push({ day: d(10), at: "x", savedOn: d(11), source: "app", sourceKey: k("note:late", d(10)), note: "вспомнил вчерашний урок" });
    r.marks.push({ day: d(12), at: "x", savedOn: d(12), source: "self" }); // a self mark in an app-confirmed run
    r.marks.push({ day: d(-1), at: "x", savedOn: d(-1), source: "app", sourceKey: k("note:before", d(-1)) });
    r.marks.push({ day: d(30), at: "x", savedOn: d(30), source: "app", sourceKey: k("note:after", d(30)) });
    expect(confirmedDays(r, check)).toBe(10);
    expect(r.marks.some((m) => m.note)).toBe(true);
  });

  it("a sourceKey alone is not a proof: the record must be saved in the Journal on that day, one record per day", () => {
    const r = run({}, 5);
    const d = (i: number) => addDaysToKey(START, i);
    r.marks.push({ day: d(5), at: "x", savedOn: d(5), source: "app" }); // no record at all
    r.marks.push({ day: d(6), at: "x", savedOn: d(6), source: "app", sourceKey: "note:invented" }); // never saved
    journal.set("note:other-day", d(2));
    r.marks.push({ day: d(7), at: "x", savedOn: d(7), source: "app", sourceKey: "note:other-day" }); // saved on another day
    r.marks.push({ day: d(8), at: "x", savedOn: d(8), source: "app", sourceKey: r.marks[0].sourceKey }); // one record, two days
    expect(confirmedDays(r, check)).toBe(5);
    // with no record check nothing app-confirmed counts (fail closed); self-reports need none
    expect(confirmedDays(r, NO_RECORDS)).toBe(0);
    expect(confirmedDays(run({ category: "habits", verification: "self" }, 7), NO_RECORDS)).toBe(7);
  });

  it("the period is 30 game days; the day after the last day awaits the report", () => {
    const r = run();
    expect(endDayOf(r)).toBe("2026-12-15");
    expect(phaseOf(r, "2026-12-15")).toBe("active");
    expect(phaseOf(r, "2026-12-16")).toBe("awaitingReport");
  });
});

describe("settling (variant C; the game does not use it before QH-8.5)", () => {
  it("only after the period and with a report of 80+ characters; the rank and the XP once per run", () => {
    const r = run({}, 27);
    expect(settleRun(r, [], REPORT, endDayOf(r), "t", check)).toEqual({ failure: "periodNotOver" });
    expect(settleRun(r, [], "", after(r), "t", check)).toEqual({ failure: "reportMissing" });
    expect(settleRun(r, [], "коротко", after(r), "t", check)).toEqual({ failure: "reportShort" });
    const ok = settleRun(r, [], REPORT, after(r), "t", check);
    expect(ok).toMatchObject({ entry: { runId: r.id, rank: "silver", days: 27, xp: 180, verification: "app" } });
    const ledger = [(ok as { entry: PQLedgerEntry }).entry];
    expect(settleRun(r, ledger, REPORT, addDaysToKey(after(r), 3), "t", check)).toEqual({ failure: "alreadySettled" });
  });

  it("the approved rates: data 100 / 180 / 250, self-report 50 / 90 / 125 for the same ranks; no Coins", () => {
    expect(PQ_RANK_XP).toEqual({ app: { bronze: 100, silver: 180, gold: 250 }, self: { bronze: 50, silver: 90, gold: 125 } });
    const pay = (verification: "app" | "self", category: PQCategoryId, hits: number) => {
      const r = run({ verification, category }, hits);
      return (settleRun(r, [], REPORT, after(r), "t", check) as { entry: PQLedgerEntry }).entry;
    };
    expect([21, 25, 29].map((h) => pay("app", "learning", h).xp)).toEqual([100, 180, 250]);
    expect([21, 25, 29].map((h) => pay("self", "habits", h).xp)).toEqual([50, 90, 125]);
    expect(pay("self", "habits", 29)).toMatchObject({ rank: "gold", verification: "self" });
    expect(Object.keys(pay("app", "learning", 30))).not.toContain("coins");
  });

  it("app marks without saved records give no rank and no XP", () => {
    const r = run({}, 30);
    expect(settleRun(r, [], REPORT, after(r), "t", NO_RECORDS)).toMatchObject({ entry: { rank: null, xp: 0, days: 0 } });
  });

  it("fewer than 21 days: settled without a rank or a reward, kept in the history", () => {
    expect(settleRun(run({}, 20), [], REPORT, "2026-12-16", "t", check)).toMatchObject({ entry: { rank: null, xp: 0, days: 20 } });
  });

  it("an abandoned run pays nothing", () => {
    expect(settleRun(run({ status: "abandoned" }, 30), [], REPORT, "2026-12-16", "t", check)).toEqual({ failure: "abandoned" });
  });

  it("a repeat is a new run with its own entry; the earlier paid run is never paid again", () => {
    const first = run({}, 30);
    const e1 = (settleRun(first, [], REPORT, after(first), "t", check) as { entry: PQLedgerEntry }).entry;
    const second = run({ startDay: after(first) }, 25);
    const e2 = (settleRun(second, [e1], REPORT, after(second), "t", check) as { entry: PQLedgerEntry }).entry;
    expect([e1.runId, e2.runId]).toEqual([first.id, second.id]);
    expect(settleRun(first, [e1, e2], REPORT, after(second), "t", check)).toEqual({ failure: "alreadySettled" });
  });
});

describe("starting runs", () => {
  const next = (questId: string, category: PQCategoryId = "habits") => ({ questId, category, verification: "self" as const, title: "t", goal: "g", dailyAction: "a", startState: "s", expectedResult: "e" });

  it(`at most ${PQ_MAX_ACTIVE} active (a run awaiting its report counts); the same quest cannot run twice at once`, () => {
    const runs = [run({ questId: "a", category: "learning" }), run({ questId: "b", category: "discipline" }), run({ questId: "c", category: "psychology" })];
    expect(canStart(runs, next("d"), START)).toBe("maxActive");
    expect(canStart(runs.slice(0, 2), next("a"), START)).toBe("sameQuestActive");
    expect(canStart(runs.slice(0, 2), next("d"), START)).toBeNull();
    // the period over but no report yet: still holds its slot
    expect(canStart(runs, next("d"), "2026-12-16")).toBe("maxActive");
    // settled runs free their slots
    expect(canStart(runs.map((r) => ({ ...r, status: "completed" as const })), next("d"), "2026-12-16")).toBeNull();
  });

  it("one active quest per category (В-20), until it is settled or abandoned", () => {
    const runs = [run({ questId: "a", category: "habits", verification: "self" })];
    expect(canStart(runs, next("b", "habits"), START)).toBe("categoryActive");
    expect(canStart(runs, next("b", "physical"), START)).toBeNull();
    expect(canStart(runs, next("b", "habits"), "2026-12-16")).toBe("categoryActive"); // awaiting the report
    expect(canStart([{ ...runs[0], status: "completed" }], next("b", "habits"), "2026-12-16")).toBeNull();
  });

  it("an abandoned quest restarts at once (В-22) as a new run: new id, its own period, no progress; the old run stays", () => {
    const old = run({ questId: "a", category: "habits", verification: "self" }, 12);
    old.status = "abandoned";
    const today = addDaysToKey(START, 12);
    expect(canStart([old], next("a", "habits"), today)).toBeNull();
    const fresh = run({ questId: "a", category: "habits", verification: "self", startDay: today });
    expect(fresh.id).not.toBe(old.id);
    expect(endDayOf(fresh)).toBe(addDaysToKey(today, 29));
    expect(confirmedDays(fresh, check)).toBe(0);
    expect(confirmedDays(old, check)).toBe(12);
    expect(settleRun(old, [], REPORT, addDaysToKey(after(old), 1), "t", check)).toEqual({ failure: "abandoned" });
  });

  it("a category allows only its own confirmations; every field is required", () => {
    expect(canStart([], { ...next("x"), category: "trading", verification: "self" }, START)).toBe("verificationNotAllowed");
    expect(canStart([], { ...next("x"), category: "physical", verification: "app" }, START)).toBe("verificationNotAllowed");
    expect(canStart([], { ...next("x"), category: "nope" as never }, START)).toBe("unknownCategory");
    expect(canStart([], { ...next("x"), title: "  " }, START)).toBe("missingFields");
  });
});

describe("category achievements", () => {
  const entry = (rank: PQLedgerEntry["rank"], runId: string, category: PQLedgerEntry["category"] = "learning", verification: PQLedgerEntry["verification"] = "app"): PQLedgerEntry => ({ runId, questId: "q", category, rank, days: 0, xp: 0, day: START, at: "t", verification });

  it("the best rank ever: raised by a better run, never lowered, never duplicated", () => {
    let a = withAchievement({}, entry("bronze", "r1")).next;
    expect(a.learning).toMatchObject({ rank: "bronze", runId: "r1" });
    const same = withAchievement(a, entry("bronze", "r2"));
    expect(same.upgraded).toBe(false);
    a = withAchievement(a, entry("gold", "r3")).next;
    expect(withAchievement(a, entry("silver", "r4"))).toEqual({ next: a, upgraded: false });
    expect(a.learning).toMatchObject({ rank: "gold", runId: "r3" });
    expect(withAchievement(a, entry(null, "r5")).upgraded).toBe(false);
    expect(withAchievement(a, entry("bronze", "r6", "habits")).next.habits).toMatchObject({ rank: "bronze" });
  });

  it("the same rank for data and self-report; the way it was confirmed is kept with it", () => {
    const a = withAchievement({}, entry("gold", "r7", "habits", "self")).next;
    expect(a.habits).toMatchObject({ rank: "gold", verification: "self" });
    // a data-confirmed run of the same rank does not duplicate or replace it
    expect(withAchievement(a, entry("gold", "r8", "habits", "app")).upgraded).toBe(false);
  });
});

describe("the registry", () => {
  it("six categories, each with RU/EN name, description, achievement and an icon; trading never confirmed by self-report", () => {
    expect(PQ_CATEGORIES.map((c) => c.id)).toEqual(["discipline", "physical", "learning", "psychology", "trading", "habits"]);
    for (const c of PQ_CATEGORIES) {
      for (const d of [ru, en]) {
        expect(d.personalQuests.categories[c.id].name.length).toBeGreaterThan(0);
        expect(d.personalQuests.categories[c.id].description.length).toBeGreaterThan(0);
        expect(d.personalQuests.achievements[c.id].name.length).toBeGreaterThan(0);
      }
      expect(c.icon.length).toBeGreaterThan(0);
      if (c.verification.includes("app")) expect(c.appChecks.length).toBeGreaterThan(0);
    }
    expect(PQ_CATEGORIES.find((c) => c.id === "trading")!.verification).toEqual(["app"]);
    expect(ru.personalQuests.achievements.discipline.name).toBe("Несломленный");
    expect(ru.personalQuests.achievements.habits.name).toBe("Архитектор себя");
  });

  it("16–17 (В-23): physical and psychology stay open with neutral wording; no body or diagnosis goals in their texts", () => {
    expect(PQ_CATEGORIES.filter((c) => c.minorSafeWording).map((c) => c.id)).toEqual(["physical", "psychology"]);
    // word starts only: «квест» contains «вес»
    const banned = /(^|[^а-яё])(вес|похуд|калори|диет|диагноз)|weight|calori|diet|diagnos/i;
    for (const d of [ru, en]) {
      for (const id of ["physical", "psychology"] as const) {
        const texts = [d.personalQuests.categories[id].name, d.personalQuests.categories[id].description, d.personalQuests.achievements[id].name, d.personalQuests.achievements[id].description, ...Object.values(d.personalQuests.path.examples[id]), ...Object.values(d.personalQuests.path.examplesMinor[id])];
        for (const t of texts) expect(t).not.toMatch(banned);
      }
    }
  });

});
