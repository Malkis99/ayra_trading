import { describe, it, expect } from "vitest";
import { addDaysToKey } from "./day-key";
import {
  PQ_CATEGORIES,
  PQ_MAX_ACTIVE,
  PROPOSED_RANK_XP,
  canStart,
  confirmedDays,
  endDayOf,
  phaseOf,
  rankFor,
  settleRun,
  withAchievement,
  type PQLedgerEntry,
  type PQRun,
} from "./personal-quests";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";
import * as fs from "fs";
import * as path from "path";

// QH-8.1: the personal quest model (not wired to the game; no XP is given anywhere).

const START = "2026-11-16";
const REPORT = "Итог тридцати дней: что изменилось, что получилось, где сорвался и что делаю дальше — честно и по делу.";
let seq = 0;
function run(over: Partial<PQRun> = {}, hits = 0): PQRun {
  const r: PQRun = { id: `r${++seq}`, questId: "q1", category: "learning", title: "Урок в день", goal: "Учиться", dailyAction: "Один урок", startState: "", expectedResult: "", verification: "app", startDay: START, marks: [], status: "active", ...over };
  for (let i = 0; i < hits; i++) {
    const day = addDaysToKey(r.startDay, i);
    r.marks.push({ day, at: `${day}T19:00:00.000Z`, savedOn: day, source: r.verification, sourceKey: r.verification === "app" ? `note:${i}` : undefined });
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
  it("one per day; outside the period, backfilled, wrong-source or unconfirmed app marks do not count", () => {
    const r = run({}, 10);
    const d = (i: number) => addDaysToKey(START, i);
    r.marks.push({ day: d(0), at: "x", savedOn: d(0), source: "app", sourceKey: "note:again" }); // the same day again
    r.marks.push({ day: d(10), at: "x", savedOn: d(11), source: "app", sourceKey: "note:late" }); // saved the next day
    r.marks.push({ day: d(12), at: "x", savedOn: d(12), source: "self" }); // a self mark in an app-confirmed run
    r.marks.push({ day: d(13), at: "x", savedOn: d(13), source: "app" }); // no confirming record
    r.marks.push({ day: d(-1), at: "x", savedOn: d(-1), source: "app", sourceKey: "note:before" });
    r.marks.push({ day: d(30), at: "x", savedOn: d(30), source: "app", sourceKey: "note:after" });
    expect(confirmedDays(r)).toBe(10);
  });

  it("the period is 30 game days; the day after the last day awaits the report", () => {
    const r = run();
    expect(endDayOf(r)).toBe("2026-12-15");
    expect(phaseOf(r, "2026-12-15")).toBe("active");
    expect(phaseOf(r, "2026-12-16")).toBe("awaitingReport");
  });
});

describe("settling (proposed rewards; the game does not use them yet)", () => {
  it("only after the period and with a report of 80+ characters; the rank and the proposed XP once per run", () => {
    const r = run({}, 27);
    expect(settleRun(r, [], REPORT, endDayOf(r), "t")).toEqual({ failure: "periodNotOver" });
    expect(settleRun(r, [], "", after(r), "t")).toEqual({ failure: "reportMissing" });
    expect(settleRun(r, [], "коротко", after(r), "t")).toEqual({ failure: "reportShort" });
    const ok = settleRun(r, [], REPORT, after(r), "t");
    expect(ok).toMatchObject({ entry: { runId: r.id, rank: "silver", days: 27, xp: PROPOSED_RANK_XP.silver } });
    const ledger = [(ok as { entry: PQLedgerEntry }).entry];
    expect(settleRun(r, ledger, REPORT, addDaysToKey(after(r), 3), "t")).toEqual({ failure: "alreadySettled" });
  });

  it("fewer than 21 days: settled without a rank or a reward, kept in the history", () => {
    expect(settleRun(run({}, 20), [], REPORT, "2026-12-16", "t")).toMatchObject({ entry: { rank: null, xp: 0, days: 20 } });
  });

  it("an abandoned run pays nothing", () => {
    expect(settleRun(run({ status: "abandoned" }, 30), [], REPORT, "2026-12-16", "t")).toEqual({ failure: "abandoned" });
  });

  it("a repeat is a new run with its own entry; the earlier paid run is never paid again", () => {
    const first = run({}, 30);
    const e1 = (settleRun(first, [], REPORT, after(first), "t") as { entry: PQLedgerEntry }).entry;
    const second = run({ startDay: after(first) }, 25);
    const e2 = (settleRun(second, [e1], REPORT, after(second), "t") as { entry: PQLedgerEntry }).entry;
    expect([e1.runId, e2.runId]).toEqual([first.id, second.id]);
    expect(settleRun(first, [e1, e2], REPORT, after(second), "t")).toEqual({ failure: "alreadySettled" });
  });
});

describe("starting runs", () => {
  const next = (questId: string) => ({ questId, category: "habits" as const, verification: "self" as const, title: "t", goal: "g", dailyAction: "a" });

  it(`at most ${PQ_MAX_ACTIVE} active (a run awaiting its report counts); the same quest cannot run twice at once`, () => {
    const runs = [run({ questId: "a" }), run({ questId: "b" }), run({ questId: "c" })];
    expect(canStart(runs, next("d"), START)).toBe("maxActive");
    expect(canStart(runs.slice(0, 2), next("a"), START)).toBe("sameQuestActive");
    expect(canStart(runs.slice(0, 2), next("d"), START)).toBeNull();
    // the period over but no report yet: still holds its slot
    expect(canStart(runs, next("d"), "2026-12-16")).toBe("maxActive");
    // settled runs free their slots
    expect(canStart(runs.map((r) => ({ ...r, status: "completed" as const })), next("d"), "2026-12-16")).toBeNull();
  });

  it("a category allows only its own confirmations; every field is required", () => {
    expect(canStart([], { ...next("x"), category: "trading", verification: "self" }, START)).toBe("verificationNotAllowed");
    expect(canStart([], { ...next("x"), category: "physical", verification: "app" }, START)).toBe("verificationNotAllowed");
    expect(canStart([], { ...next("x"), category: "nope" as never }, START)).toBe("unknownCategory");
    expect(canStart([], { ...next("x"), title: "  " }, START)).toBe("missingFields");
  });
});

describe("category achievements", () => {
  const entry = (rank: PQLedgerEntry["rank"], runId: string, category: PQLedgerEntry["category"] = "learning"): PQLedgerEntry => ({ runId, questId: "q", category, rank, days: 0, xp: 0, day: START, at: "t", verification: "app" });

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

  it("not wired: no game, store or UI file imports the model (no XP before the rates are approved)", () => {
    const roots = ["lib", "components", "app"].map((d) => path.join(__dirname, "..", d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f.name) && !/\.test\.ts$/.test(f.name) && !/personal-quests\.ts$|econ-sim-qh8\.ts$/.test(f.name)) {
          if (/from ["'](\.\/|@\/lib\/)personal-quests["']/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
