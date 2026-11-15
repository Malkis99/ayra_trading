import { describe, it, expect } from "vitest";
import { LocalStorageJournalRepository } from "./journal/repository";
import { candidateSources, checkMissions, hasTradesBefore, missionsForMode, type MissionData, type MissionId } from "./missions";
import type { BacktestResult, Note, Trade, TradingPlan } from "./journal/types";

// QH-6.2 (docs/quest-hub-qh6-spec.md): the nine verifiable missions on saved journal data. Pure — no reward here.

const DAY = "2026-11-16"; // Monday
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
const plan = (over: Partial<TradingPlan> = {}): TradingPlan => ({
  date: DAY,
  bias: [{ instrument: "EURUSD", direction: "bullish" } as never],
  levels: [{ instrument: "EURUSD", price: 1.1, label: "POI" } as never],
  events: [],
  limits: { maxTrades: 3 },
  checklist: [{ key: "risk_limits_checked", done: true }],
  createdAt: at(DAY, "07:00"),
  updatedAt: at(DAY, "07:00"),
  ...over,
});
const note = (id: string, templateKey: Note["templateKey"], body: string, over: Partial<Note> = {}): Note => ({
  id, templateKey, body, tags: [], pinned: false, createdAt: at(DAY, "12:00"), updatedAt: at(DAY, "12:00"), archivedAt: null, ...over,
});
const result = (over: Partial<BacktestResult> = {}): BacktestResult => ({
  instrument: "EURUSD", timeframe: "H1", periodFrom: "2026-01-01", periodTo: "2026-06-30", setup: "Retest", strategyId: null,
  setups: 20, wins: 11, losses: 7, breakeven: 2, avgWinR: null, avgLossR: null, ...over,
});
/** A text of exactly n characters with no space at either end (lengths are counted on the trimmed text). */
const text = (n: number, seed = "a") => `${seed}${`${seed}b `.repeat(n)}`.slice(0, n - 1) + "z";
const btNote = (id: string, r = result(), over: Partial<Note> = {}) => note(id, "backtest", text(70, id), { backtest: r, ...over });
const trade = (id: string, over: Partial<Trade> = {}): Trade => ({
  id, accountId: "a", instrument: "EURUSD", direction: "long", status: "closed", openedAt: at("2026-11-10", "10:00"), result: "win",
  emotions: [], mistakes: [], verification: "unverified", source: "manual", createdAt: at("2026-11-10", "10:00"), updatedAt: at("2026-11-10", "10:00"),
  schemaVersion: 6, ...over,
} as Trade);
const data = (over: Partial<MissionData> = {}): MissionData => ({ plans: [], notes: [], trades: [], timezone: "UTC", ...over });
const done = (id: MissionId, d: MissionData, day = DAY) => candidateSources(id, d, day).length > 0;

describe("QH-6.2: the missions of each mode", () => {
  it("trading, study (trade review or observation), recovery; a rest day asks for nothing", () => {
    expect(missionsForMode("trading", true)).toEqual(["q_bias", "q_riskcheck", "q_reflect"]);
    expect(missionsForMode("study", true)).toEqual(["m_trade_review", "m_backtest", "m_lesson"]);
    expect(missionsForMode("study", false)).toEqual(["m_observation", "m_backtest", "m_lesson"]);
    expect(missionsForMode("recovery", false)).toEqual(["m_day_state", "m_mistake", "m_plan_tomorrow"]);
    expect(missionsForMode("rest", true)).toEqual([]);
    expect(checkMissions([], data(), DAY).checks).toEqual([]);
  });

  it("an empty journal: every mission open, nothing breaks", () => {
    const ids: MissionId[] = ["q_bias", "q_riskcheck", "q_reflect", "m_trade_review", "m_observation", "m_backtest", "m_lesson", "m_day_state", "m_mistake", "m_plan_tomorrow"];
    const { checks } = checkMissions(ids, data(), DAY);
    expect(checks.every((c) => !c.done)).toBe(true);
  });

  it("the study slot: observation only when the journal had no trade before today (a trade made today does not switch it)", () => {
    expect(hasTradesBefore([], DAY)).toBe(false);
    expect(hasTradesBefore([trade("t1", { createdAt: at(DAY, "09:00") })], DAY)).toBe(false);
    expect(hasTradesBefore([trade("t1")], DAY)).toBe(true);
    expect(hasTradesBefore([trade("t1", { deletedAt: at(DAY, "08:00") })], DAY)).toBe(false);
  });
});

describe("QH-6.2: trading — Preparation, Risk control, Day review", () => {
  it("Preparation: a direction AND a zone of interest, in today's plan made today", () => {
    expect(done("q_bias", data({ plans: [plan()] }))).toBe(true);
    expect(done("q_bias", data({ plans: [plan({ levels: [] })] }))).toBe(false);
    expect(done("q_bias", data({ plans: [plan({ bias: [] })] }))).toBe(false);
    expect(done("q_bias", data({ plans: [plan({ date: "2026-11-15" })] }))).toBe(false);
  });

  it("a plan made in advance needs today's confirmation of direction and POI (В16); yesterday's save gives nothing", () => {
    const early = plan({ createdAt: at("2026-11-15", "18:00") });
    expect(done("q_bias", data({ plans: [early] }))).toBe(false);
    expect(done("q_riskcheck", data({ plans: [early] }))).toBe(false);
    const confirmed = { ...early, prepConfirmedAt: at(DAY, "07:30") };
    expect(done("q_bias", data({ plans: [confirmed] }))).toBe(true);
    expect(done("q_riskcheck", data({ plans: [confirmed] }))).toBe(true);
    expect(done("q_bias", data({ plans: [{ ...early, prepConfirmedAt: at("2026-11-15", "19:00") }] }))).toBe(false);
  });

  it("Risk control: a structured limit AND the standard checklist item; an own item with «риск» is not enough (В9)", () => {
    expect(done("q_riskcheck", data({ plans: [plan()] }))).toBe(true);
    expect(done("q_riskcheck", data({ plans: [plan({ limits: {} })] }))).toBe(false);
    expect(done("q_riskcheck", data({ plans: [plan({ checklist: [{ text: "Проверил риск", done: true }] })] }))).toBe(false);
    expect(done("q_riskcheck", data({ plans: [plan({ checklist: [{ key: "risk_limits_checked", done: false }] })] }))).toBe(false);
    expect(done("q_riskcheck", data({ plans: [plan({ limits: { maxDailyLoss: { value: 2, unit: "percent" } as never } })] }))).toBe(true);
  });

  it("Day review: a review completed today with 40+ characters, or today's «Session review» note of 80+", () => {
    const review = (n: number, day = DAY) => plan({ review: { rating: 4, followedPlan: "yes", emotions: [], whatWorked: text(n), completedAt: at(day, "20:00") } });
    expect(done("q_reflect", data({ plans: [review(40)] }))).toBe(true);
    expect(done("q_reflect", data({ plans: [review(39)] }))).toBe(false);
    expect(done("q_reflect", data({ plans: [review(60, "2026-11-15")] }))).toBe(false);
    expect(done("q_reflect", data({ notes: [note("s1", "session_review", text(80))] }))).toBe(true);
    expect(done("q_reflect", data({ notes: [note("s1", "session_review", text(79))] }))).toBe(false);
  });
});

describe("QH-6.2: study — Trade review / Observation, Backtest, Lesson", () => {
  it("Trade review: a past trade whose review became complete today; old reviews without a time and today's trades do not count", () => {
    expect(done("m_trade_review", data({ trades: [trade("t1", { reviewedAt: at(DAY, "11:00") })] }))).toBe(true);
    // reviewed before QH-6.1: complete review, no reviewedAt
    expect(done("m_trade_review", data({ trades: [trade("t1", { entryReason: "R", emotions: ["calm"], executionRating: 4 })] }))).toBe(false);
    expect(done("m_trade_review", data({ trades: [trade("t1", { reviewedAt: at("2026-11-15", "11:00") })] }))).toBe(false);
    expect(done("m_trade_review", data({ trades: [trade("t2", { createdAt: at(DAY, "09:00"), openedAt: at(DAY, "09:00"), reviewedAt: at(DAY, "11:00") })] }))).toBe(false);
  });

  it("Observation and Lesson: a new note of 60+ characters made today; a copy of an older text does not count", () => {
    expect(done("m_observation", data({ notes: [note("i1", "idea", text(60))] }))).toBe(true);
    expect(done("m_observation", data({ notes: [note("i1", "idea", text(59))] }))).toBe(false);
    expect(done("m_lesson", data({ notes: [note("l1", "lesson", text(60))] }))).toBe(true);
    const old = note("l0", "lesson", text(70, "b"), { createdAt: at("2026-11-01", "10:00"), deletedAt: at("2026-11-02", "10:00") });
    // the same text under a new id (spaces and case changed) — not new, even if the old note was deleted
    expect(done("m_lesson", data({ notes: [old, note("l1", "lesson", `  ${text(70, "b").toUpperCase()}  `)] }))).toBe(false);
  });

  it("Backtest: a complete result (10+ setups, numbers add up) made today; a copy of an earlier result does not count", () => {
    expect(done("m_backtest", data({ notes: [btNote("b1")] }))).toBe(true);
    expect(done("m_backtest", data({ notes: [btNote("b1", result({ setups: 9, wins: 4, losses: 5, breakeven: 0 }))] }))).toBe(false);
    expect(done("m_backtest", data({ notes: [btNote("b1", result({ wins: 3 }))] }))).toBe(false);
    expect(done("m_backtest", data({ notes: [btNote("b1", result(), { body: "short" })] }))).toBe(false);
    const earlier = btNote("b0", result(), { createdAt: at("2026-11-10", "10:00") });
    expect(done("m_backtest", data({ notes: [earlier, btNote("b1")] }))).toBe(false);
    // the same numbers for another strategy is another result
    expect(done("m_backtest", data({ notes: [earlier, btNote("b1", result({ strategyId: "str_b" }))] }))).toBe(true);
  });
});

describe("QH-6.2: recovery — Day state, Mistake review, Plan for tomorrow", () => {
  it("Day state: a rating and an emotion saved today (no text needed)", () => {
    const state = (over = {}) => plan({ review: { rating: 3, followedPlan: "partly", emotions: ["calm"], completedAt: at(DAY, "19:00"), ...over } });
    expect(done("m_day_state", data({ plans: [state()] }))).toBe(true);
    expect(done("m_day_state", data({ plans: [state({ emotions: [] })] }))).toBe(false);
    expect(done("m_day_state", data({ plans: [state({ rating: 0 })] }))).toBe(false);
  });

  it("Mistake review: a new «Weekly mistake» note of 80+ characters made today", () => {
    expect(done("m_mistake", data({ notes: [note("w1", "weekly_mistake", text(80))] }))).toBe(true);
    expect(done("m_mistake", data({ notes: [note("w1", "weekly_mistake", text(79))] }))).toBe(false);
  });

  it("Plan for tomorrow: tomorrow's plan made today; tomorrow it gives Preparation only after its own confirmation", () => {
    const tomorrow = plan({ date: "2026-11-17", createdAt: at(DAY, "21:00"), updatedAt: at(DAY, "21:00") });
    expect(done("m_plan_tomorrow", data({ plans: [tomorrow] }))).toBe(true);
    expect(done("m_plan_tomorrow", data({ plans: [{ ...tomorrow, bias: [], note: "" }] }))).toBe(false);
    expect(done("m_plan_tomorrow", data({ plans: [{ ...tomorrow, createdAt: at("2026-11-15", "21:00") }] }))).toBe(false);
    // the next day: no Preparation from yesterday's save …
    expect(done("q_bias", data({ plans: [tomorrow] }), "2026-11-17")).toBe(false);
    // … until the person confirms it on that day
    expect(done("q_bias", data({ plans: [{ ...tomorrow, prepConfirmedAt: at("2026-11-17", "07:00") }] }), "2026-11-17")).toBe(true);
  });
});

describe("QH-6.2: imports, copies, repeated saves", () => {
  it("imported notes and backtests never count, even after an edit (the repository keeps the import mark)", () => {
    localStorage.clear();
    const repo = new LocalStorageJournalRepository();
    repo.importNotes([{ ...note("imp1", "lesson", text(80)), importBatchId: "b1", importedAt: at(DAY, "10:00") }, { ...btNote("imp2"), importBatchId: "b1" }]);
    expect(done("m_lesson", data({ notes: repo.getAllRecords().notes }))).toBe(false);
    expect(done("m_backtest", data({ notes: repo.getAllRecords().notes }))).toBe(false);
    // the note form builds a fresh object without the mark: the repository keeps it
    repo.saveNote(note("imp1", "lesson", `${text(80)} edited today`));
    expect(repo.getNote("imp1")?.importBatchId).toBe("b1");
    expect(done("m_lesson", data({ notes: repo.getAllRecords().notes }))).toBe(false);
  });

  it("saving the same note again or checking again confirms nothing new", () => {
    const d = data({ notes: [note("l1", "lesson", text(70))] });
    const first = checkMissions(["m_lesson"], d, DAY);
    expect(first.checks[0]).toMatchObject({ done: true, source: "note:l1", claimed: false });
    const again = checkMissions(["m_lesson"], { ...d, notes: [{ ...d.notes[0], updatedAt: at(DAY, "13:00") }] }, DAY, first.ledger);
    expect(again.checks[0]).toMatchObject({ done: true, source: "note:l1", claimed: true });
    expect(again.ledger).toBe(first.ledger);
  });
});

describe("QH-6.2: one source, one mission a day — mode changes and two tabs", () => {
  const reviewPlan = plan({ review: { rating: 4, followedPlan: "yes", emotions: ["calm"], whatWorked: text(60), completedAt: at(DAY, "19:00") } });

  it("a mode change: the day review used by «Day state» cannot also close «Day review»; another source can", () => {
    const d = data({ plans: [reviewPlan] });
    const recovery = checkMissions(missionsForMode("recovery", true), d, DAY);
    expect(recovery.checks.find((c) => c.id === "m_day_state")).toMatchObject({ done: true, source: `plan:${DAY}:review` });
    const trading = checkMissions(missionsForMode("trading", true), d, DAY, recovery.ledger);
    expect(trading.checks.find((c) => c.id === "q_reflect")).toMatchObject({ done: false });
    const withNote = checkMissions(missionsForMode("trading", true), { ...d, notes: [note("s1", "session_review", text(90))] }, DAY, recovery.ledger);
    expect(withNote.checks.find((c) => c.id === "q_reflect")).toMatchObject({ done: true, source: "note:s1" });
  });

  it("two parts of one plan are two sources (direction+POI and limits+checklist): both trading missions can be done", () => {
    const { checks } = checkMissions(["q_bias", "q_riskcheck"], data({ plans: [plan()] }), DAY);
    expect(checks.map((c) => c.source)).toEqual([`plan:${DAY}:prep`, `plan:${DAY}:risk`]);
  });

  it("two tabs: the same data and ledger give the same answer; the second tab adds no confirmation", () => {
    const d = data({ plans: [plan()], notes: [note("l1", "lesson", text(70))] });
    const ids: MissionId[] = ["q_bias", "q_riskcheck", "m_lesson"];
    const a = checkMissions(ids, d, DAY);
    const b = checkMissions(ids, d, DAY);
    expect(b.checks).toEqual(a.checks);
    const bAfterA = checkMissions(ids, d, DAY, a.ledger);
    expect(bAfterA.checks.every((c) => c.claimed)).toBe(true);
    expect(bAfterA.ledger).toBe(a.ledger);
  });

  it("a ledger of another day is not carried over", () => {
    const d = data({ notes: [note("l1", "lesson", text(70))] });
    const old = { day: "2026-11-15", claims: { m_lesson: "note:l1" } };
    expect(checkMissions(["m_lesson"], d, DAY, old).checks[0]).toMatchObject({ done: true, claimed: false });
  });
});

describe("QH-6.2: time zones and midnight", () => {
  it("a note at 23:30 in Tbilisi counts for that day, not for the next; one at 00:10 counts for the next", () => {
    // Tbilisi = UTC+4: 19:30 UTC is 23:30 local on 11-16; 20:10 UTC is 00:10 local on 11-17
    const late = note("l1", "lesson", text(70), { createdAt: "2026-11-16T19:30:00.000Z" });
    const after = note("l2", "lesson", text(70, "z"), { createdAt: "2026-11-16T20:10:00.000Z" });
    const d = data({ notes: [late, after], timezone: "Asia/Tbilisi" });
    expect(candidateSources("m_lesson", d, "2026-11-16")).toEqual(["note:l1"]);
    expect(candidateSources("m_lesson", d, "2026-11-17")).toEqual(["note:l2"]);
    // the same moment in UTC is still 11-16
    expect(candidateSources("m_lesson", { ...d, timezone: "UTC" }, "2026-11-16")).toEqual(["note:l1", "note:l2"]);
  });

  it("New York: a plan made at 22:00 local (03:00 UTC next day) belongs to the local day", () => {
    const ny = plan({ date: "2026-11-16", createdAt: "2026-11-17T03:00:00.000Z" }); // 22:00 on 11-16 in New York
    expect(done("q_bias", data({ plans: [ny], timezone: "America/New_York" }))).toBe(true);
    expect(done("q_bias", data({ plans: [ny], timezone: "UTC" }))).toBe(false);
  });
});

describe("QH-6.2: no reward, nothing changed", () => {
  it("the checks never change their input and give no XP or Coins (they only name the confirming record)", () => {
    const d = data({ plans: [plan()], notes: [note("l1", "lesson", text(70)), btNote("b1")], trades: [trade("t1", { reviewedAt: at(DAY, "11:00") })] });
    const snapshot = JSON.stringify(d);
    const r = checkMissions(["q_bias", "q_riskcheck", "q_reflect", "m_trade_review", "m_backtest", "m_lesson"], d, DAY);
    expect(JSON.stringify(d)).toBe(snapshot);
    for (const c of r.checks) expect(Object.keys(c).sort()).toEqual(c.done ? ["claimed", "done", "id", "source"] : ["claimed", "done", "id"]);
  });
});
