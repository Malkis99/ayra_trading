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
/** The fields of a complete trade review (isTradeReviewed). */
const REVIEW: Partial<Trade> = { entryReason: "Retest of the London high", emotions: ["calm"], executionRating: 4 };
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
    expect(done("q_riskcheck", data({ plans: [plan({ limits: { maxDailyLoss: { type: "percent", value: 2 } } })] }))).toBe(true);
  });

  it("Preparation needs a real direction and a real level: no empty, unknown or broken values (review of #177)", () => {
    const prep = (over: Partial<TradingPlan>) => done("q_bias", data({ plans: [plan(over)] }));
    // the direction: an instrument and one of the plan's directions
    expect(prep({ bias: [{ instrument: "", direction: "bullish" }] })).toBe(false);
    expect(prep({ bias: [{ instrument: "   ", direction: "bearish" }] })).toBe(false);
    expect(prep({ bias: [{ instrument: "EURUSD", direction: "" as never }] })).toBe(false);
    expect(prep({ bias: [{ instrument: "EURUSD", direction: "up" as never }] })).toBe(false);
    expect(prep({ bias: [{ instrument: "EURUSD" } as never] })).toBe(false);
    expect(prep({ bias: [null as never] })).toBe(false);
    for (const direction of ["bullish", "bearish", "neutral"] as const) expect(prep({ bias: [{ instrument: "EURUSD", direction }] })).toBe(true);
    // the level: a positive finite price
    expect(prep({ levels: [{ instrument: "EURUSD", label: "POI" }] })).toBe(false); // an empty row added by «+ level»
    expect(prep({ levels: [{ price: 0 }] })).toBe(false);
    expect(prep({ levels: [{ price: -1.1 }] })).toBe(false);
    expect(prep({ levels: [{ price: Number.NaN }] })).toBe(false);
    expect(prep({ levels: [{ price: Number.POSITIVE_INFINITY }] })).toBe(false);
    expect(prep({ levels: [{ price: "1.1" as never }] })).toBe(false);
    expect(prep({ levels: [null as never] })).toBe(false);
    expect(prep({ levels: [{ price: 0 }, { price: 1.0832 }] })).toBe(true); // one real level is enough
    // an incomplete plan
    expect(prep({ bias: [{ instrument: "EURUSD", direction: "bullish" }], levels: [{ label: "POI" }] })).toBe(false);
    expect(prep({ bias: [{ instrument: "", direction: "bullish" }], levels: [{ price: 1.1 }] })).toBe(false);
    expect(prep({ bias: undefined as never, levels: undefined as never })).toBe(false);
  });

  it("Risk control needs valid limits: positive finite R or % (no more than 100%), a whole positive number of trades (review of #177)", () => {
    const risk = (limits: TradingPlan["limits"], checklist = [{ key: "risk_limits_checked", done: true }]) => done("q_riskcheck", data({ plans: [plan({ limits, checklist })] }));
    expect(risk({ maxRiskPerTrade: { type: "r", value: 1 } })).toBe(true);
    expect(risk({ maxRiskPerTrade: { type: "percent", value: 0.5 } })).toBe(true);
    expect(risk({ maxDailyLoss: { type: "r", value: 3 } })).toBe(true);
    expect(risk({ maxTrades: 2 })).toBe(true);
    // zero, negative, broken
    expect(risk({ maxRiskPerTrade: { type: "r", value: 0 } })).toBe(false);
    expect(risk({ maxRiskPerTrade: { type: "r", value: -1 } })).toBe(false);
    expect(risk({ maxDailyLoss: { type: "percent", value: Number.NaN } })).toBe(false);
    expect(risk({ maxDailyLoss: { type: "percent", value: Number.POSITIVE_INFINITY } })).toBe(false);
    expect(risk({ maxDailyLoss: { type: "percent", value: "2" as never } })).toBe(false);
    expect(risk({ maxDailyLoss: { value: 2 } as never })).toBe(false); // no unit
    expect(risk({ maxDailyLoss: { type: "usd", value: 2 } as never })).toBe(false); // an unknown unit
    expect(risk({ maxRiskPerTrade: { type: "percent", value: 150 } })).toBe(false); // more than the whole account
    expect(risk({ maxTrades: 0 })).toBe(false);
    expect(risk({ maxTrades: -2 })).toBe(false);
    expect(risk({ maxTrades: 2.5 })).toBe(false);
    expect(risk({ maxTrades: Number.NaN })).toBe(false);
    // one broken limit spoils the set; an empty set is not a limit
    expect(risk({ maxTrades: 3, maxDailyLoss: { type: "r", value: -2 } })).toBe(false);
    expect(risk({})).toBe(false);
    expect(risk(undefined)).toBe(false);
    // the standard checklist item stays required
    expect(risk({ maxTrades: 3 }, [])).toBe(false);
    expect(risk({ maxTrades: 3 }, [{ key: "risk_limits_checked", done: false }])).toBe(false);
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
    expect(done("m_trade_review", data({ trades: [trade("t1", { ...REVIEW, reviewedAt: at(DAY, "11:00") })] }))).toBe(true);
    // reviewed before QH-6.1: complete review, no reviewedAt
    expect(done("m_trade_review", data({ trades: [trade("t1", REVIEW)] }))).toBe(false);
    expect(done("m_trade_review", data({ trades: [trade("t1", { ...REVIEW, reviewedAt: at("2026-11-15", "11:00") })] }))).toBe(false);
    expect(done("m_trade_review", data({ trades: [trade("t2", { ...REVIEW, createdAt: at(DAY, "09:00"), openedAt: at(DAY, "09:00"), reviewedAt: at(DAY, "11:00") })] }))).toBe(false);
  });

  it("Trade review: the review must still be complete — a removed reason, emotions or rating takes the confirmation away (review of #177)", () => {
    const reviewed = (over: Partial<Trade>) => done("m_trade_review", data({ trades: [trade("t1", { ...REVIEW, reviewedAt: at(DAY, "11:00"), ...over })] }));
    expect(reviewed({})).toBe(true);
    expect(reviewed({ entryReason: undefined })).toBe(false);
    expect(reviewed({ entryReason: "   " })).toBe(false);
    expect(reviewed({ emotions: [] })).toBe(false);
    expect(reviewed({ emotions: undefined as never })).toBe(false);
    expect(reviewed({ executionRating: undefined })).toBe(false);
    expect(reviewed({ executionRating: 0 })).toBe(false);
    expect(reviewed({ executionRating: 6 })).toBe(false);
    expect(reviewed({ executionRating: 3.5 })).toBe(false);
    // a stamp alone (a copy that never had the fields) is not a review
    expect(done("m_trade_review", data({ trades: [trade("t1", { reviewedAt: at(DAY, "11:00") })] }))).toBe(false);
    // through the repository: the review is cleared before the first check → nothing to confirm (the time stays)
    localStorage.clear();
    const repo = new LocalStorageJournalRepository();
    repo.saveTrade(trade("t9"));
    const stamped = repo.saveTrade({ ...trade("t9"), ...REVIEW });
    expect(stamped.reviewedAt).toBeTruthy();
    const cleared = repo.saveTrade({ ...stamped, entryReason: "" });
    expect(cleared.reviewedAt).toBe(stamped.reviewedAt);
    const day = stamped.reviewedAt!.slice(0, 10);
    expect(candidateSources("m_trade_review", data({ trades: [stamped] }), day)).toEqual(["trade:t9:review"]);
    expect(candidateSources("m_trade_review", data({ trades: [cleared] }), day)).toEqual([]);
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

  it("a plan is «made» at its first real save (firstSavedAt), not when its draft was opened; old plans fall back to createdAt (review of #177)", () => {
    // the draft of tomorrow's plan was opened yesterday evening and first saved today
    const opened = plan({ date: "2026-11-17", createdAt: at("2026-11-15", "22:00"), firstSavedAt: at(DAY, "21:00") });
    expect(done("m_plan_tomorrow", data({ plans: [opened] }))).toBe(true);
    expect(done("m_plan_tomorrow", data({ plans: [opened] }), "2026-11-15")).toBe(false);
    // today's plan: the draft opened last night, filled and saved this morning → today's work, no extra confirmation
    expect(done("q_bias", data({ plans: [plan({ createdAt: at("2026-11-15", "23:00"), firstSavedAt: at(DAY, "07:00") })] }))).toBe(true);
    // a plan saved before the field existed: createdAt as before
    expect(done("m_plan_tomorrow", data({ plans: [plan({ date: "2026-11-17", createdAt: at(DAY, "21:00") })] }))).toBe(true);
  });

  it("the repository stamps firstSavedAt once, at the first save; it never moves and ignores what the copy says (review of #177)", () => {
    localStorage.clear();
    const repo = new LocalStorageJournalRepository();
    const draft = plan({ date: "2026-11-17", createdAt: at("2026-11-10", "08:00") }); // a draft opened long ago
    const first = repo.saveTradingPlan(draft);
    expect(first.firstSavedAt).toBeTruthy();
    expect(first.firstSavedAt).not.toBe(draft.createdAt);
    expect(first.createdAt).toBe(draft.createdAt); // createdAt is untouched (the plan-discipline reward reads it)
    // later saves — and a copy that claims another time — keep the first one
    const later = repo.saveTradingPlan({ ...draft, note: "edit", firstSavedAt: at("2030-01-01", "00:00") });
    expect(later.firstSavedAt).toBe(first.firstSavedAt);
    // a plan saved before the field existed stays without it (it is not made now)
    localStorage.clear();
    const legacyRepo = new LocalStorageJournalRepository();
    legacyRepo.replaceAllRecords({ ...legacyRepo.getAllRecords(), plans: [plan({ date: "2026-11-20" })] });
    expect(legacyRepo.saveTradingPlan(plan({ date: "2026-11-20", note: "edit" })).firstSavedAt).toBeUndefined();
    // a plan deleted and made again is a new plan
    legacyRepo.deleteTradingPlan("2026-11-20");
    expect(legacyRepo.saveTradingPlan(plan({ date: "2026-11-20" })).firstSavedAt).toBeTruthy();
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
  // only the review part: the direction and the limits would close two more trading missions (three a day at most)
  const reviewPlan = plan({ bias: [], levels: [], limits: {}, review: { rating: 4, followedPlan: "yes", emotions: ["calm"], whatWorked: text(60), completedAt: at(DAY, "19:00") } });

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

  it("never more than three missions a day, whatever list is passed: repeats, a mix of modes, unknown ids (review of #177)", () => {
    const rich = data({
      plans: [plan({ review: { rating: 4, followedPlan: "yes", emotions: ["calm"], whatWorked: text(60), completedAt: at(DAY, "19:00") } })],
      notes: [note("l1", "lesson", text(70)), note("w1", "weekly_mistake", text(90, "w")), note("i1", "idea", text(70, "i")), btNote("b1")],
    });
    // nine ids of three modes, every one with a source of its own
    const all: MissionId[] = ["q_bias", "q_riskcheck", "q_reflect", "m_observation", "m_backtest", "m_lesson", "m_day_state", "m_mistake", "m_plan_tomorrow"];
    const r = checkMissions(all, rich, DAY);
    expect(r.checks.filter((c) => c.done)).toHaveLength(3);
    expect(Object.keys(r.ledger.claims)).toHaveLength(3);
    // a repeated id is checked once
    const dup = checkMissions(["m_lesson", "m_lesson", "m_lesson"], rich, DAY);
    expect(dup.checks).toHaveLength(1);
    // claims kept from earlier in the day count towards the three (a mode change after three is closed adds nothing)
    const morning = checkMissions(["q_bias", "q_riskcheck", "q_reflect"], rich, DAY);
    expect(morning.checks.every((c) => c.done)).toBe(true);
    const evening = checkMissions(["m_observation", "m_backtest", "m_lesson"], rich, DAY, morning.ledger);
    expect(evening.checks.some((c) => c.done)).toBe(false);
    expect(evening.ledger).toBe(morning.ledger);
    // an unknown id confirms nothing and does not break the check
    const odd = checkMissions(["x_unknown" as MissionId, "m_lesson"], rich, DAY);
    expect(odd.checks.map((c) => c.done)).toEqual([false, true]);
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
    const d = data({ plans: [plan()], notes: [note("l1", "lesson", text(70)), btNote("b1")], trades: [trade("t1", { ...REVIEW, reviewedAt: at(DAY, "11:00") })] });
    const snapshot = JSON.stringify(d);
    const r = checkMissions(["q_bias", "q_riskcheck", "q_reflect", "m_trade_review", "m_backtest", "m_lesson"], d, DAY);
    expect(JSON.stringify(d)).toBe(snapshot);
    for (const c of r.checks) expect(Object.keys(c).sort()).toEqual(c.done ? ["claimed", "done", "id", "source"] : ["claimed", "done", "id"]);
  });
});
