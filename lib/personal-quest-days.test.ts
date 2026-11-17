import { describe, it, expect } from "vitest";
import { addDaysToKey } from "./day-key";
import { checkMissions, type MissionData } from "./missions";
import type { Note, Trade, TradingPlan } from "./journal/types";
import { allocateAppMarks, appMarks, journalRecordCheck, journeyOf, journeysOf } from "./personal-quest-days";
import { chapterOf, endDayOf, settleRun, type PQRun } from "./personal-quests";

// QH-8.3: data-confirmed days come from the saved Journal by the Quest Hub checks — never from a stored key.

const START = "2026-11-16";
const d = (i: number) => addDaysToKey(START, i);
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
const LESSON = (n: number) => `Урок ${n}: жду закрытия свечи над уровнем и только потом вхожу по плану, без спешки и догадок.`;
const note = (id: string, templateKey: Note["templateKey"], body: string, day: string, over: Partial<Note> = {}): Note => ({
  id, templateKey, body, tags: [], pinned: false, createdAt: at(day, "12:00"), updatedAt: at(day, "12:00"), archivedAt: null, ...over,
});
const plan = (day: string, over: Partial<TradingPlan> = {}): TradingPlan => ({
  date: day,
  bias: [{ instrument: "EURUSD", direction: "bullish" } as never],
  levels: [{ instrument: "EURUSD", price: 1.1, label: "POI" } as never],
  events: [],
  checklist: [],
  createdAt: at(day, "07:00"),
  firstSavedAt: at(day, "07:00"),
  updatedAt: at(day, "07:00"),
  ...over,
});
const data = (over: Partial<MissionData> = {}): MissionData => ({ plans: [], notes: [], trades: [] as Trade[], timezone: "UTC", ...over });
const run = (over: Partial<PQRun> = {}): PQRun => ({
  id: "pq_run_1", questId: "pqq_1", category: "learning", verification: "app", title: "Урок", goal: "g", dailyAction: "a", startState: "s", expectedResult: "e",
  startDay: START, marks: [], status: "active", ...over,
});

describe("the Journal check (PQRecordCheck)", () => {
  const lessons = data({ notes: [note("n1", "lesson", LESSON(1), d(0)), note("n2", "lesson", LESSON(2), d(1))] });
  const check = journalRecordCheck(lessons);
  const mark = (day: string, sourceKey?: string) => ({ day, savedOn: day, at: "", source: "app" as const, sourceKey });

  it("a real record of that day, of the category's kind, confirms; anything else does not", () => {
    expect(check(mark(d(0), "note:n1"), run())).toBe(true);
    expect(check(mark(d(0), "note:invented"), run())).toBe(false); // not in the Journal
    expect(check(mark(d(1), "note:n1"), run())).toBe(false); // a record of another day
    expect(check(mark(d(0)), run())).toBe(false); // no key at all
    // the same lesson does not confirm a psychology quest (another kind of record)
    expect(check(mark(d(0), "note:n1"), run({ category: "psychology" }))).toBe(false);
  });

  it("imported notes, notes under the minimum and copies of an earlier text confirm nothing", () => {
    const j = data({
      notes: [
        note("imp", "lesson", LESSON(3), d(0), { importBatchId: "batch1" }),
        note("short", "lesson", "Коротко.", d(1)),
        note("orig", "lesson", LESSON(4), d(1)),
        note("copy", "lesson", LESSON(4), d(2)),
      ],
    });
    expect(appMarks(run(), j, d(5))).toEqual([expect.objectContaining({ day: d(1), sourceKey: "note:orig", check: "m_lesson" })]);
    const c = journalRecordCheck(j);
    expect(c(mark(d(0), "note:imp"), run())).toBe(false);
    expect(c(mark(d(2), "note:copy"), run())).toBe(false);
  });

  it("a day plan confirms discipline and trading (preparation) — no trade needed", () => {
    const j = data({ plans: [plan(d(0))] });
    expect(appMarks(run({ category: "trading" }), j, d(0))).toEqual([expect.objectContaining({ sourceKey: `plan:${d(0)}:prep`, check: "q_bias" })]);
    expect(appMarks(run({ category: "discipline" }), j, d(0))).toHaveLength(1);
    expect(appMarks(run({ category: "learning" }), j, d(0))).toHaveLength(0);
  });

  it("the day is the account's game day: a lesson at 21:30 UTC counts for the next day in Tbilisi", () => {
    const j = data({ notes: [note("late", "lesson", LESSON(5), d(0), { createdAt: at(d(0), "21:30") })], timezone: "Asia/Tbilisi" });
    expect(appMarks(run(), j, d(3)).map((m) => m.day)).toEqual([d(1)]);
    expect(appMarks(run(), { ...j, timezone: "UTC" }, d(3)).map((m) => m.day)).toEqual([d(0)]);
  });

  it("one record confirms one day; two records on one day still confirm one day", () => {
    const j = data({ notes: [note("a", "lesson", LESSON(6), d(0)), note("b", "lesson", LESSON(7), d(0), { createdAt: at(d(0), "13:00") })] });
    const marks = appMarks(run(), j, d(4));
    expect(marks).toHaveLength(1);
    expect(journeyOf(run(), d(4), j).confirmed).toBe(1);
  });

  it("stored app marks are never trusted: only the Journal decides", () => {
    const forged = run({ marks: [{ day: d(0), savedOn: d(0), at: "", source: "app", sourceKey: "note:n1" }, { day: d(1), savedOn: d(1), at: "", source: "app", sourceKey: "note:fake" }] });
    expect(journeyOf(forged, d(2), data()).confirmed).toBe(0);
    expect(journeyOf(forged, d(2), lessons).confirmed).toBe(2); // the Journal's own records, not the stored keys
  });
});

describe("the 30 days", () => {
  it("confirmed, missed, today, future; a missed day never resets; the calendar day is not the count of done days", () => {
    const r = run({ category: "habits", verification: "self", marks: [d(0), d(1), d(3)].map((day) => ({ day, savedOn: day, at: at(day, "19:00"), source: "self" as const })) });
    const j = journeyOf(r, d(4), null);
    expect(j.days.slice(0, 6).map((x) => x.state)).toEqual(["confirmed", "confirmed", "missed", "confirmed", "today", "future"]);
    expect(j.confirmed).toBe(3);
    expect(j.missed).toBe(1);
    expect(j.pending).toBe(false);
  });

  it("a self mark saved on another day (backfilled) does not count", () => {
    const r = run({ verification: "self", category: "habits", marks: [{ day: d(0), savedOn: d(1), at: "", source: "self" }] });
    expect(journeyOf(r, d(1), null).confirmed).toBe(0);
  });

  it("while the Journal is not read, data-confirmed days wait for the check — never «missed», never «done»", () => {
    const j = journeyOf(run(), d(3), null);
    expect(j.pending).toBe(true);
    expect(j.days.slice(0, 5).map((x) => x.state)).toEqual(["pending", "pending", "pending", "pending", "future"]);
    expect(j.confirmed).toBe(0);
    expect(j.missed).toBe(0);
  });

  it("an abandoned run: days after it stopped are closed; its marks stay", () => {
    const r = run({ verification: "self", category: "habits", status: "abandoned", abandonedAt: at(d(2), "10:00"), marks: [{ day: d(1), savedOn: d(1), at: "", source: "self" }] });
    const j = journeyOf(r, d(6), null, "UTC");
    expect(j.days.slice(0, 5).map((x) => x.state)).toEqual(["missed", "confirmed", "missed", "closed", "closed"]);
    expect(j.confirmed).toBe(1);
  });

  it("different quests are independent", () => {
    const j = data({ notes: [note("n1", "lesson", LESSON(8), d(0))], plans: [plan(d(0))] });
    expect(journeyOf(run(), d(0), j).confirmed).toBe(1);
    expect(journeyOf(run({ id: "pq_run_2", category: "trading" }), d(0), j).confirmed).toBe(1);
    expect(journeyOf(run({ id: "pq_run_3", category: "psychology" }), d(0), j).confirmed).toBe(0);
  });
});

describe("chapters by the calendar", () => {
  it("days 1–7, 8–14, 15–21, 22–30", () => {
    expect([1, 7, 8, 14, 15, 21, 22, 30].map((n) => chapterOf(n).id)).toEqual([
      "awareness", "awareness", "resistance", "resistance", "strengthening", "strengthening", "consolidation", "consolidation",
    ]);
  });
});

describe("В-24: one Journal record confirms at most one personal quest", () => {
  // discipline and trading both accept a day plan (q_bias); trading also a session review (q_reflect)
  const disc = run({ id: "pq_disc", questId: "pqq_disc", category: "discipline", startDay: d(0), createdAt: at(d(0), "08:00") });
  const trad = run({ id: "pq_trad", questId: "pqq_trad", category: "trading", startDay: d(0), createdAt: at(d(0), "09:00") });
  const REVIEW = "Итог сессии: держался плана, вошёл только по сетапу, стоп не двигал; вывод — ждать подтверждения на младшем ТФ.";
  const confirmedOn = (a: ReturnType<typeof allocateAppMarks>, id: string) => (a.marks.get(id) ?? []).map((m) => m.day);

  it("one day plan and two quests: only one is confirmed (the earlier one keeps it); the other says the record is taken", () => {
    const a = allocateAppMarks([disc, trad], data({ plans: [plan(d(0))] }), d(0));
    expect(confirmedOn(a, "pq_disc")).toEqual([d(0)]);
    expect(confirmedOn(a, "pq_trad")).toEqual([]);
    expect(a.takenBy.get("pq_trad")!.get(d(0))).toBe("pq_disc");
    const j = journeysOf([disc, trad], d(0), data({ plans: [plan(d(0))] }));
    expect(j.get("pq_disc")!.confirmed + j.get("pq_trad")!.confirmed).toBe(1);
    expect(j.get("pq_trad")!.takenBy.get(d(0))).toBe("pq_disc");
  });

  it("two independent records of a day: both quests are confirmed — whichever quest has priority", () => {
    const j = data({ plans: [plan(d(0))], notes: [note("rev", "session_review", REVIEW, d(0))] });
    for (const runs of [[disc, trad], [trad, disc]]) {
      const a = allocateAppMarks(runs, j, d(0));
      expect(confirmedOn(a, "pq_disc")).toEqual([d(0)]);
      expect(confirmedOn(a, "pq_trad")).toEqual([d(0)]);
      expect(a.marks.get("pq_disc")![0].sourceKey).not.toBe(a.marks.get("pq_trad")![0].sourceKey);
    }
    // even when the trading quest started first: it takes the review so that the plan can confirm discipline
    const early = { ...trad, createdAt: at(d(0), "07:00") };
    const a = allocateAppMarks([disc, early], j, d(0));
    expect(a.marks.get("pq_trad")![0].sourceKey).toBe("note:rev");
    expect(a.marks.get("pq_disc")![0].sourceKey).toBe(`plan:${d(0)}:prep`);
  });

  it("the order of cards or calls never changes the result", () => {
    const j = data({ plans: [0, 1, 2, 3].map((i) => plan(d(i))), notes: [note("rev", "session_review", REVIEW, d(2))] });
    const third = run({ id: "pq_psy", category: "psychology", startDay: d(1), createdAt: at(d(1), "08:00") });
    const base = allocateAppMarks([disc, trad, third], j, d(3));
    for (const order of [[trad, third, disc], [third, disc, trad], [trad, disc, third]]) {
      const a = allocateAppMarks(order, j, d(3));
      expect(Object.fromEntries(a.marks)).toEqual(Object.fromEntries(base.marks));
    }
  });

  it("a record may count for a Quest Hub mission of the day and one personal quest", () => {
    const j = data({ plans: [plan(d(0))] });
    expect(checkMissions(["q_bias"], j, d(0)).checks[0].done).toBe(true);
    expect(allocateAppMarks([disc], j, d(0)).marks.get("pq_disc")!.map((m) => m.sourceKey)).toEqual([`plan:${d(0)}:prep`]);
  });

  it("a deleted or emptied record takes its confirmation away, and the next quest may take a remaining one", () => {
    const j = data({ plans: [plan(d(0))], notes: [note("rev", "session_review", REVIEW, d(0))] });
    expect(confirmedOn(allocateAppMarks([disc, trad], j, d(0)), "pq_disc")).toEqual([d(0)]);
    const deleted = data({ plans: [plan(d(0), { deletedAt: at(d(0), "15:00") })], notes: j.notes });
    const a = allocateAppMarks([disc, trad], deleted, d(0));
    expect(confirmedOn(a, "pq_disc")).toEqual([]);
    expect(confirmedOn(a, "pq_trad")).toEqual([d(0)]); // the review still counts for trading
    const emptied = data({ plans: [plan(d(0), { bias: [] })] });
    expect(confirmedOn(allocateAppMarks([disc, trad], emptied, d(0)), "pq_disc")).toEqual([]);
  });

  it("time zones: a plan saved at 21:30 UTC is the next day's in Tbilisi — and still goes to one quest only", () => {
    const p1 = plan(d(1), { createdAt: at(d(0), "21:30"), firstSavedAt: at(d(0), "21:30") });
    const tb = allocateAppMarks([disc, trad], data({ plans: [p1], timezone: "Asia/Tbilisi" }), d(2), "Asia/Tbilisi");
    expect(confirmedOn(tb, "pq_disc")).toEqual([d(1)]);
    expect(confirmedOn(tb, "pq_trad")).toEqual([]);
    // in UTC the same plan was made the day before its date: there it is «Plan for tomorrow» of that day (a discipline
    // check trading does not accept) — still one quest, one day
    const utc = allocateAppMarks([disc, trad], data({ plans: [p1] }), d(2));
    expect(utc.marks.get("pq_disc")!.map((m) => [m.day, m.check])).toEqual([[d(0), "m_plan_tomorrow"]]);
    expect(confirmedOn(utc, "pq_trad")).toEqual([]);
  });

  it("an abandoned run never keeps a record a running quest needs (the day of a restart included)", () => {
    const old = { ...trad, id: "pq_old", status: "abandoned" as const, abandonedAt: at(d(0), "12:00"), startDay: addDaysToKey(d(0), -5), createdAt: at(addDaysToKey(d(0), -5), "08:00") };
    const fresh = { ...trad, id: "pq_new", restartOf: "pq_old", startDay: d(0), createdAt: at(d(0), "12:01") };
    const a = allocateAppMarks([old, fresh], data({ plans: [plan(d(0))] }), d(0));
    expect(confirmedOn(a, "pq_new")).toEqual([d(0)]);
    expect(confirmedOn(a, "pq_old")).toEqual([]);
  });

  it("no double counting in the future settlement: two quests over 30 days get as many days as there are records", () => {
    // 30 day plans, and session reviews on 10 of the days
    const days = Array.from({ length: 30 }, (_, i) => d(i));
    const j = data({
      plans: days.map((day) => plan(day)),
      notes: days.slice(0, 10).map((day, i) => note(`rev${i}`, "session_review", `${REVIEW} День ${i + 1}.`, day)),
    });
    const after = addDaysToKey(endDayOf(disc), 1);
    const a = allocateAppMarks([disc, trad], j, after);
    const check = journalRecordCheck(j);
    const REPORT = "Итог тридцати дней: что изменилось, что получилось, где сорвался и что делаю дальше — честно и по делу.";
    const settled = [disc, trad].map((r) => settleRun({ ...r, marks: a.marks.get(r.id)! }, [], REPORT, after, "t", check));
    const total = settled.reduce((n, x) => n + ("entry" in x ? x.entry.days : 0), 0);
    expect(total).toBe(40); // 30 plans + 10 reviews: each record once
    const keys = [...a.marks.get("pq_disc")!, ...a.marks.get("pq_trad")!].map((m) => m.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    // the same distribution on a reload (a fresh call) and in another tab (another order)
    expect(Object.fromEntries(allocateAppMarks([trad, disc], j, after).marks)).toEqual(Object.fromEntries(a.marks));
  });

  it("self-reported quests use no Journal records and are not affected", () => {
    const self = run({ id: "pq_self", category: "discipline", verification: "self", marks: [{ day: d(0), savedOn: d(0), at: "", source: "self" }] });
    const j = journeysOf([disc, self], d(0), data({ plans: [plan(d(0))] }));
    expect(j.get("pq_disc")!.confirmed).toBe(1);
    expect(j.get("pq_self")!.confirmed).toBe(1);
  });
});
