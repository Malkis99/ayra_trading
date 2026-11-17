import { describe, it, expect } from "vitest";
import { addDaysToKey } from "./day-key";
import type { MissionData } from "./missions";
import type { Note, Trade, TradingPlan } from "./journal/types";
import { appMarks, journalRecordCheck, journeyOf } from "./personal-quest-days";
import { chapterOf, type PQRun } from "./personal-quests";

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
