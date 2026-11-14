import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository } from "./repository";
import { CloudJournalRepository } from "./cloud/cloud-repository";
import { FakeRemote, trade } from "./cloud/testing/fake-remote";
import { markInitialSyncDone } from "./cloud/sync-state";
import { hasRecordsOfKind } from "./first-actions";
import { journalBackupJson } from "./export";
import {
  BACKTEST_MIN_SETUPS,
  backtestFingerprint,
  backtestWinRate,
  isCompleteBacktest,
  isTradeReviewed,
  readBacktest,
  stampReview,
  validateBacktest,
} from "./backtest";
import type { BacktestResult, Note, Trade } from "./types";

// QH-6.1 (docs/quest-hub-qh6-spec.md, 3–4): the backtest result inside notes and the time of a trade review.
// Journal data only — nothing here gives a reward.

const TODAY = "2026-11-14";
const CONCLUSION = "The retest setup works in the London session and fails in Asia; I keep it for London only from now.";
const result = (over: Partial<BacktestResult> = {}): BacktestResult => ({
  instrument: "EURUSD",
  timeframe: "H1",
  periodFrom: "2026-01-01",
  periodTo: "2026-06-30",
  setup: "Retest after a breakout",
  strategyId: null,
  setups: 20,
  wins: 11,
  losses: 7,
  breakeven: 2,
  avgWinR: 1.8,
  avgLossR: -1,
  ...over,
});
const note = (id: string, r: BacktestResult = result(), over: Partial<Note> = {}): Note => ({
  id,
  title: "EURUSD H1",
  body: CONCLUSION,
  tags: [],
  pinned: false,
  templateKey: "backtest",
  backtest: r,
  createdAt: `${TODAY}T10:00:00.000Z`,
  updatedAt: `${TODAY}T10:00:00.000Z`,
  archivedAt: null,
  ...over,
});
const reviewed = (t: Trade): Trade => ({ ...t, entryReason: "Retest of the level", emotions: ["calm"], executionRating: 4 });

describe("QH-6.1 backtest result: validation", () => {
  it("a full, consistent result passes", () => {
    expect(validateBacktest(result(), CONCLUSION, TODAY)).toEqual([]);
    expect(isCompleteBacktest(note("n1"), TODAY)).toBe(true);
  });

  it("numbers: whole, not negative, at least 10 setups, and the outcomes add up to the setups", () => {
    expect(validateBacktest(result({ setups: 9, wins: 5, losses: 4, breakeven: 0 }), CONCLUSION, TODAY)).toEqual(["setupsMin"]);
    expect(BACKTEST_MIN_SETUPS).toBe(10);
    expect(validateBacktest(result({ wins: 12 }), CONCLUSION, TODAY)).toEqual(["sum"]);
    expect(validateBacktest(result({ wins: 10.5 }), CONCLUSION, TODAY)).toEqual(["numbers"]);
    expect(validateBacktest(result({ losses: -1, wins: 19 }), CONCLUSION, TODAY)).toEqual(["numbers"]);
    expect(validateBacktest({ ...result(), setups: Number.NaN }, CONCLUSION, TODAY)).toEqual(["numbers"]);
  });

  it("required fields, the period and the conclusion", () => {
    expect(validateBacktest(result({ instrument: " " }), CONCLUSION, TODAY)).toEqual(["instrument"]);
    expect(validateBacktest({ ...result(), timeframe: "W1" as never }, CONCLUSION, TODAY)).toEqual(["timeframe"]);
    expect(validateBacktest(result({ setup: "" }), CONCLUSION, TODAY)).toEqual(["setup"]);
    expect(validateBacktest(result({ periodFrom: "2026-07-01" }), CONCLUSION, TODAY)).toEqual(["periodOrder"]);
    expect(validateBacktest(result({ periodTo: "2026-11-20" }), CONCLUSION, TODAY)).toEqual(["periodFuture"]);
    expect(validateBacktest(result({ periodFrom: "01.01.2026" }), CONCLUSION, TODAY)).toEqual(["periodFrom"]);
    expect(validateBacktest(result(), "x".repeat(59), TODAY)).toEqual(["conclusion"]);
    expect(validateBacktest(result(), `  ${"x".repeat(59)}  `, TODAY)).toEqual(["conclusion"]);
    expect(validateBacktest(result(), "x".repeat(60), TODAY)).toEqual([]);
    expect(validateBacktest(result({ avgWinR: Number.NaN }), CONCLUSION, TODAY)).toEqual(["avgR"]);
  });

  it("a saved result is read back; a damaged one (another version, broken data) is not taken as valid", () => {
    expect(readBacktest(note("n1"))).toEqual(result());
    expect(readBacktest({ templateKey: "lesson", backtest: result() })).toBeNull();
    expect(readBacktest({ templateKey: "backtest" })).toBeNull();
    expect(readBacktest({ templateKey: "backtest", backtest: { ...result(), wins: "11" } as never })).toBeNull();
    expect(isCompleteBacktest(note("n2", result({ wins: 3 })), TODAY)).toBe(false);
    expect(isCompleteBacktest(note("n3", result(), { body: "short" }), TODAY)).toBe(false);
  });

  it("equivalence: the same result only with the same instrument, timeframe, period, numbers AND the same strategy or setup", () => {
    const fp = (o: Partial<BacktestResult> = {}) => backtestFingerprint(result(o));
    // a copy: the same result (case, spaces, the conclusion and average R do not matter)
    expect(fp({ instrument: "eurusd", setup: "  retest   AFTER a breakout ", avgWinR: 3, avgLossR: null })).toBe(fp());
    // different numbers, period or timeframe: different results
    expect(fp({ wins: 10, breakeven: 3 })).not.toBe(fp());
    expect(fp({ periodTo: "2026-06-29" })).not.toBe(fp());
    expect(fp({ timeframe: "H4" })).not.toBe(fp());
    // equal instrument, period and numbers but a different setup or strategy: never the same result
    expect(fp({ setup: "Range fade" })).not.toBe(fp());
    expect(fp({ strategyId: "str_a" })).not.toBe(fp({ strategyId: "str_b" }));
    expect(fp({ strategyId: "str_a" })).not.toBe(fp());
    // a journal strategy is identified by its id: renaming it (the setup text) keeps the same result
    expect(fp({ strategyId: "str_a", setup: "Old name" })).toBe(fp({ strategyId: "str_a", setup: "New name" }));
    expect(backtestWinRate(result())).toBe(55);
  });
});

describe("QH-6.1 trade review time (reviewedAt)", () => {
  it("set when the review first becomes complete; never moved; the caller's value is ignored", () => {
    const base = trade("t1");
    expect(isTradeReviewed(base)).toBe(false);
    expect(stampReview(undefined, base, "2026-11-14T10:00:00.000Z").reviewedAt).toBeUndefined();
    const first = stampReview(base, reviewed(base), "2026-11-14T10:00:00.000Z");
    expect(first.reviewedAt).toBe("2026-11-14T10:00:00.000Z");
    const again = stampReview(first, { ...reviewed(base), notes: "edited", reviewedAt: "2030-01-01T00:00:00.000Z" }, "2026-11-15T10:00:00.000Z");
    expect(again.reviewedAt).toBe("2026-11-14T10:00:00.000Z");
    expect(stampReview(undefined, { ...base, reviewedAt: "2026-11-14T10:00:00.000Z" }, "2026-11-14T11:00:00.000Z").reviewedAt).toBeUndefined();
  });

  it("a trade reviewed before QH-6.1 (no time) gets none on a later edit: it was not reviewed now", () => {
    const legacy = reviewed(trade("t1"));
    expect(stampReview(legacy, { ...legacy, notes: "edited" }, "2026-11-14T10:00:00.000Z").reviewedAt).toBeUndefined();
  });
});

describe("QH-6.1 journal storage, sync, export and old records", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });
  afterEach(() => AppStorage.setUserId(null));

  it("the repository stamps reviews on save, keeps the first time, and an import never sets it", () => {
    const repo = new LocalStorageJournalRepository();
    repo.saveTrade(trade("t1"));
    expect(repo.getTrade("t1")?.reviewedAt).toBeUndefined();
    repo.saveTrade(reviewed(trade("t1")));
    const at = repo.getTrade("t1")?.reviewedAt;
    expect(at).toBeTruthy();
    repo.saveTrade({ ...reviewed(trade("t1")), notes: "later edit", reviewedAt: undefined });
    expect(repo.getTrade("t1")?.reviewedAt).toBe(at);
    // a trade file with a review and a forged time: imported without the time
    repo.importTrades([{ ...reviewed(trade("t2")), reviewedAt: "2026-11-14T09:00:00.000Z" }]);
    expect(repo.getTrade("t2")?.reviewedAt).toBeUndefined();
    // deleted and restored: the old review is not «done now»
    repo.importTrades([reviewed(trade("t3"))]);
    repo.deleteTrade("t3");
    repo.saveTrade(reviewed(trade("t3")));
    expect(repo.getTrade("t3")?.reviewedAt).toBeUndefined();
  });

  it("a backtest result is saved and read back intact; old notes without it still load", () => {
    const repo = new LocalStorageJournalRepository();
    repo.saveNote(note("bt1"));
    repo.saveNote({ id: "n_old", body: "an old note", tags: [], pinned: false, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
    const reloaded = new LocalStorageJournalRepository();
    expect(readBacktest(reloaded.getNote("bt1")!)).toEqual(result());
    expect(reloaded.getNote("n_old")?.backtest).toBeUndefined();
  });

  it("a backtest result is not «a note» for the one-time first-note reward", () => {
    const snap = { trades: [], accounts: [], strategies: [], plans: [], weekPlans: [], noTrades: [], notes: [note("bt1")] } as never;
    expect(hasRecordsOfKind(snap, [], "note")).toBe(false);
    const both = { trades: [], accounts: [], strategies: [], plans: [], weekPlans: [], noTrades: [], notes: [note("bt1"), { ...note("n2"), templateKey: "lesson", backtest: undefined }] } as never;
    expect(hasRecordsOfKind(both, [], "note")).toBe(true);
  });

  it("the journal backup (export) keeps the backtest result and the review time", () => {
    const repo = new LocalStorageJournalRepository();
    repo.saveNote(note("bt1"));
    repo.saveTrade(reviewed(trade("t1")));
    const json = JSON.parse(journalBackupJson(repo.getAllRecords(), []));
    expect(json.journal.notes[0].backtest).toEqual(result());
    expect(json.journal.trades[0].reviewedAt).toBeTruthy();
  });

  it("sync: the result and the review time reach another device unchanged; the other device does not re-stamp", async () => {
    const USER = "00000000-0000-0000-0000-0000000000a1";
    AppStorage.setUserId(USER);
    markInitialSyncDone(USER);
    const remote = new FakeRemote(USER);
    const a = new CloudJournalRepository(new LocalStorageJournalRepository(), remote, undefined, "tab_a");
    a.saveNote(note("bt1"));
    a.saveTrade(trade("t1"));
    a.saveTrade(reviewed(trade("t1")));
    const reviewedAt = a.getTrade("t1")?.reviewedAt;
    await a.syncNow();
    await a.whenIdle();
    expect(remote.get("journal_notes", "bt1")?.data.backtest).toEqual(result());
    expect(remote.get("journal_trades", "t1")?.data.reviewedAt).toBe(reviewedAt);
    a.dispose();

    // the other device: an empty journal downloads both
    localStorage.clear();
    AppStorage.setUserId(USER);
    markInitialSyncDone(USER);
    const b = new CloudJournalRepository(new LocalStorageJournalRepository(), remote, undefined, "tab_b");
    await b.pullFromCloud();
    expect(readBacktest(b.getNote("bt1")!)).toEqual(result());
    expect(b.getTrade("t1")?.reviewedAt).toBe(reviewedAt);
    b.dispose();
  });
});
