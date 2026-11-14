/**
 * Backtest results and trade reviews for the verifiable missions (docs/quest-hub-qh6-spec.md, 3–4; QH-6.1).
 * Journal data only: nothing here gives a reward. Mission checks (QH-6.2) read these records later.
 */
import { BACKTEST_TIMEFRAMES, type BacktestResult, type BacktestTimeframe, type Note, type Trade } from "./types";

/** Owner decision В12: a result counts only with at least this many setups. */
export const BACKTEST_MIN_SETUPS = 10;
/** Shortest conclusion (the note body), the same as a lesson (owner decisions, 2026-11-14). */
export const BACKTEST_CONCLUSION_MIN = 60;
export const BACKTEST_INSTRUMENT_MAX = 20;
export const BACKTEST_SETUP_MAX = 80;

export type BacktestError =
  | "instrument"
  | "timeframe"
  | "periodFrom"
  | "periodTo"
  | "periodOrder"
  | "periodFuture"
  | "setup"
  | "numbers"
  | "setupsMin"
  | "sum"
  | "avgR"
  | "conclusion";

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const isDayKey = (v: unknown): v is string => typeof v === "string" && KEY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Every problem of a result before it is saved (empty list: it can be saved). `today` is the day of the device
 * (YYYY-MM-DD): a period cannot end in the future. Win + loss + breakeven must equal the number of setups.
 */
export function validateBacktest(r: Partial<BacktestResult>, conclusion: string, today: string): BacktestError[] {
  const errors: BacktestError[] = [];
  const instrument = (r.instrument || "").trim();
  if (!instrument || instrument.length > BACKTEST_INSTRUMENT_MAX) errors.push("instrument");
  if (!r.timeframe || !(BACKTEST_TIMEFRAMES as readonly string[]).includes(r.timeframe)) errors.push("timeframe");
  const fromOk = isDayKey(r.periodFrom);
  const toOk = isDayKey(r.periodTo);
  if (!fromOk) errors.push("periodFrom");
  if (!toOk) errors.push("periodTo");
  if (fromOk && toOk && (r.periodFrom as string) >= (r.periodTo as string)) errors.push("periodOrder");
  if (toOk && (r.periodTo as string) > today) errors.push("periodFuture");
  const setup = (r.setup || "").trim();
  if (!setup || setup.length > BACKTEST_SETUP_MAX) errors.push("setup");
  const counts = [r.setups, r.wins, r.losses, r.breakeven];
  if (!counts.every(isCount)) errors.push("numbers");
  else {
    if ((r.setups as number) < BACKTEST_MIN_SETUPS) errors.push("setupsMin");
    if ((r.wins as number) + (r.losses as number) + (r.breakeven as number) !== r.setups) errors.push("sum");
  }
  const rOk = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100);
  if (!rOk(r.avgWinR) || !rOk(r.avgLossR)) errors.push("avgR");
  if (conclusion.trim().length < BACKTEST_CONCLUSION_MIN) errors.push("conclusion");
  return errors;
}

/** The structured result of a saved note, or null (not a backtest, or saved by another version in a broken shape). */
export function readBacktest(note: Pick<Note, "templateKey" | "backtest">): BacktestResult | null {
  if (note.templateKey !== "backtest" || !note.backtest || typeof note.backtest !== "object") return null;
  const b = note.backtest as Partial<BacktestResult>;
  if (typeof b.instrument !== "string" || !(BACKTEST_TIMEFRAMES as readonly string[]).includes(b.timeframe as string)) return null;
  if (!isDayKey(b.periodFrom) || !isDayKey(b.periodTo) || typeof b.setup !== "string") return null;
  if (![b.setups, b.wins, b.losses, b.breakeven].every(isCount)) return null;
  return {
    instrument: b.instrument,
    timeframe: b.timeframe as BacktestTimeframe,
    periodFrom: b.periodFrom,
    periodTo: b.periodTo,
    setup: b.setup,
    strategyId: typeof b.strategyId === "string" ? b.strategyId : null,
    setups: b.setups as number,
    wins: b.wins as number,
    losses: b.losses as number,
    breakeven: b.breakeven as number,
    avgWinR: typeof b.avgWinR === "number" ? b.avgWinR : null,
    avgLossR: typeof b.avgLossR === "number" ? b.avgLossR : null,
  };
}

/** A saved result is valid for a mission: its numbers add up and it has its fields (the conclusion is the body). */
export const isCompleteBacktest = (note: Pick<Note, "templateKey" | "backtest" | "body">, today: string): boolean => {
  const r = readBacktest(note);
  return !!r && validateBacktest(r, note.body || "", today).length === 0;
};

/**
 * When two saved results are «the same result» (a mission counts it once — QH-6.4, owner condition 5; an import does
 * not add it twice). All of these must match:
 * - the instrument (case ignored), the timeframe and the period (from and to);
 * - what was tested: the same journal strategy (by its id, whatever its name now) when the result is linked to one;
 *   otherwise the same setup text (case and repeated spaces ignored). A result linked to a strategy and one described
 *   only by text are different results;
 * - the four numbers: setups, wins, losses, breakeven.
 * The conclusion and the optional average R are not part of it: rewording the conclusion or rounding R again does not
 * make a new result. Different strategies or setups with equal numbers are never the same result.
 */
export function backtestFingerprint(r: BacktestResult): string {
  const tested = r.strategyId ? `strategy:${r.strategyId}` : `setup:${r.setup.replace(/\s+/g, " ").trim().toLowerCase()}`;
  return [r.instrument.trim().toUpperCase(), r.timeframe, r.periodFrom, r.periodTo, tested, r.setups, r.wins, r.losses, r.breakeven].join("|");
}

/** Share of winning setups, 0–100, rounded (null without setups). */
export const backtestWinRate = (r: Pick<BacktestResult, "setups" | "wins">): number | null => (r.setups > 0 ? Math.round((r.wins / r.setups) * 100) : null);

/* ------------------------------------------------------------------ trade review time */

/** A trade review is complete: entry reason, at least one emotion and an execution rating (the same rule as the Boss). */
export const isTradeReviewed = (t: Pick<Trade, "entryReason" | "emotions" | "executionRating">): boolean =>
  !!(t.entryReason && t.entryReason.trim()) && (t.emotions || []).length > 0 && t.executionRating != null;

/**
 * `reviewedAt` of a trade the person saves: the time the review first became complete, never moved afterwards.
 * - a time already saved is kept, whatever the new copy says;
 * - a trade whose saved copy was already reviewed (before QH-6.1, without a time) gets none: it was not reviewed now;
 * - otherwise the time is `now` when the new copy is reviewed, and nothing when it is not.
 */
export function stampReview(prev: Trade | null | undefined, next: Trade, now: string): Trade {
  const { reviewedAt: _ignored, ...rest } = next;
  if (prev?.reviewedAt) return { ...rest, reviewedAt: prev.reviewedAt };
  if (prev && isTradeReviewed(prev)) return rest as Trade;
  return isTradeReviewed(next) ? { ...rest, reviewedAt: now } : (rest as Trade);
}
