/**
 * The nine verifiable missions of QH-6 (docs/quest-hub-qh6-spec.md, sections 2 and 6; owner decisions В7–В16).
 *
 * Pure checks on saved journal data — nothing here gives XP or Coins, changes the game state or the day set. QH-6.4
 * wires the result to the rewards; QH-6.3 puts the missions into the day set.
 *
 * - «Today» is the game day in the account time zone; a record counts when it was made on that day.
 * - A record imported from a file never counts (importBatchId), even after it was edited.
 * - A note counts only when its text is new: a copy of an earlier note (another id, the same text) does not.
 * - A backtest result counts only when it is complete and no earlier result is the same result (backtestFingerprint).
 * - One record (a «source») confirms at most one mission a day: a ledger of the day keeps which source each mission
 *   used; a mission already claimed keeps its source; calling the checks again, in another tab or after a mode change
 *   gives the same answer and nothing new.
 */
import { addDaysToKey, dayKeyInZone } from "./day-key";
import { backtestFingerprint, isCompleteBacktest, readBacktest } from "./journal/backtest";
import type { Note, Trade, TradingPlan } from "./journal/types";
import type { DayMode } from "./quest-engine";

export type MissionId =
  | "q_bias" // Trading 1: Preparation
  | "q_riskcheck" // Trading 2: Risk control
  | "q_reflect" // Trading 3: Day review
  | "m_trade_review" // Study 1: Trade review
  | "m_observation" // Study 1′: Observation (no trades in the journal)
  | "m_backtest" // Study 2
  | "m_lesson" // Study 3
  | "m_day_state" // Recovery 1
  | "m_mistake" // Recovery 2
  | "m_plan_tomorrow"; // Recovery 3

/** Shortest texts (owner decisions 2026-11-14). */
export const MISSION_TEXT_MIN = { review: 40, sessionNote: 80, observation: 60, lesson: 60, mistake: 80 } as const;

/** The standard checklist item of the day plan that confirms the risk limits were checked (В9: own items do not count). */
export const RISK_CHECK_KEY = "risk_limits_checked";

/** What the checks read. Notes and trades include deleted ones (a deleted earlier copy still makes a text not new). */
export interface MissionData {
  plans: TradingPlan[];
  notes: Note[];
  trades: Trade[];
  timezone?: string;
}

/** The three missions of a mode. «Trade review» becomes «Observation» when the journal has no trades (В15). */
export function missionsForMode(mode: DayMode, hasTrades: boolean): MissionId[] {
  switch (mode) {
    case "trading":
      return ["q_bias", "q_riskcheck", "q_reflect"];
    case "study":
      return [hasTrades ? "m_trade_review" : "m_observation", "m_backtest", "m_lesson"];
    case "recovery":
      return ["m_day_state", "m_mistake", "m_plan_tomorrow"];
    case "rest":
    default:
      return []; // a rest day asks for no missions: nothing can be «not done»
  }
}

/** The journal has a live trade made before the given day (the study slot is chosen once when the day set is made). */
export function hasTradesBefore(trades: Trade[], dayKey: string, tz?: string): boolean {
  return trades.some((t) => !t.deletedAt && dayKeyInZone(new Date(t.createdAt || t.openedAt), tz) < dayKey);
}

const live = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);
const dayOf = (iso: string | undefined | null, tz?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? dayKeyInZone(new Date(iso), tz) : null);
const len = (s: string | undefined | null) => (s || "").trim().length;
const normText = (s: string | undefined | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

/** A note made by the person today: not imported, created on the game day. */
const madeToday = (n: Note, day: string, tz?: string) => !n.deletedAt && !n.importBatchId && dayOf(n.createdAt, tz) === day;

/** Its text is new: no other note (any id, deleted or imported included) made before it has the same text. */
function isNewText(n: Note, all: Note[]): boolean {
  const text = normText(n.body);
  return !all.some((o) => o.id !== n.id && normText(o.body) === text && (o.createdAt < n.createdAt || (o.createdAt === n.createdAt && o.id < n.id)));
}

/** No other backtest result made before it is the same result (another id with the same data included). */
function isNewResult(n: Note, all: Note[]): boolean {
  const r = readBacktest(n);
  if (!r) return false;
  const fp = backtestFingerprint(r);
  return !all.some((o) => {
    if (o.id === n.id || !(o.createdAt < n.createdAt || (o.createdAt === n.createdAt && o.id < n.id))) return false;
    const x = readBacktest(o);
    return !!x && backtestFingerprint(x) === fp;
  });
}

const planOn = (plans: TradingPlan[], day: string) => live(plans).find((p) => p.date === day) || null;

/**
 * Today's plan is today's work: made today, or — when made in advance — confirmed today (В16). A plan made yesterday
 * «for tomorrow» does not count today by itself.
 */
const planIsToday = (p: TradingPlan, day: string, tz?: string) => dayOf(p.createdAt, tz) === day || dayOf(p.prepConfirmedAt, tz) === day;

const hasBias = (p: TradingPlan) => (p.bias || []).some((b) => !!b.instrument && b.instrument.trim().length > 0);
const hasLimits = (p: TradingPlan) => p.limits?.maxRiskPerTrade?.value != null || p.limits?.maxDailyLoss?.value != null || p.limits?.maxTrades != null;
const riskChecked = (p: TradingPlan) => (p.checklist || []).some((c) => c.key === RISK_CHECK_KEY && c.done);
const reviewTextLen = (p: TradingPlan) => len(p.review?.whatWorked) + len(p.review?.whatToImprove) + len(p.review?.lesson);

/** Every record that would confirm a mission today, best first. A source key names one record (or one part of a plan). */
export function candidateSources(id: MissionId, data: MissionData, day: string): string[] {
  const tz = data.timezone;
  const plan = planOn(data.plans, day);
  const notes = data.notes;
  const notesOf = (template: Note["templateKey"], min: number) =>
    live(notes)
      .filter((n) => n.templateKey === template && madeToday(n, day, tz) && len(n.body) >= min && isNewText(n, notes))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((n) => `note:${n.id}`);

  switch (id) {
    case "q_bias":
      // a direction for an instrument and at least one zone of interest, in today's plan made or confirmed today
      return plan && hasBias(plan) && (plan.levels || []).length > 0 && planIsToday(plan, day, tz) ? [`plan:${day}:prep`] : [];
    case "q_riskcheck":
      // a structured limit and the standard checklist item, in today's plan made or confirmed today
      return plan && hasLimits(plan) && riskChecked(plan) && planIsToday(plan, day, tz) ? [`plan:${day}:risk`] : [];
    case "q_reflect": {
      const out: string[] = [];
      if (plan && dayOf(plan.review?.completedAt, tz) === day && reviewTextLen(plan) >= MISSION_TEXT_MIN.review) out.push(`plan:${day}:review`);
      return [...out, ...notesOf("session_review", MISSION_TEXT_MIN.sessionNote)];
    }
    case "m_trade_review":
      // a past trade (written before today) whose review first became complete today (QH-6.1 reviewedAt; trades
      // reviewed before QH-6.1 have none). A trade written today with its review is not «a past trade reviewed».
      return live(data.trades)
        .filter((t) => dayOf(t.reviewedAt, tz) === day && (dayOf(t.createdAt || t.openedAt, tz) || day) < day)
        .sort((a, b) => (a.reviewedAt || "").localeCompare(b.reviewedAt || ""))
        .map((t) => `trade:${t.id}:review`);
    case "m_observation":
      return notesOf("idea", MISSION_TEXT_MIN.observation);
    case "m_lesson":
      return notesOf("lesson", MISSION_TEXT_MIN.lesson);
    case "m_mistake":
      return notesOf("weekly_mistake", MISSION_TEXT_MIN.mistake);
    case "m_backtest":
      return live(notes)
        .filter((n) => n.templateKey === "backtest" && madeToday(n, day, tz) && isCompleteBacktest(n, day) && isNewResult(n, notes))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((n) => `note:${n.id}`);
    case "m_day_state":
      // the day's rating and at least one emotion, saved today (no text needed)
      return plan && dayOf(plan.review?.completedAt, tz) === day && (plan.review?.rating || 0) >= 1 && (plan.review?.emotions || []).length > 0 ? [`plan:${day}:review`] : [];
    case "m_plan_tomorrow": {
      const tomorrow = addDaysToKey(day, 1);
      const next = planOn(data.plans, tomorrow);
      return next && dayOf(next.createdAt, tz) === day && (hasBias(next) || len(next.note) > 0) ? [`plan:${tomorrow}:made`] : [];
    }
  }
}

/** Which source each mission of the day used. Kept for the day; a claim is never moved or reused by another mission. */
export interface MissionLedger {
  day: string;
  claims: Partial<Record<MissionId, string>>;
}

export interface MissionCheck {
  id: MissionId;
  done: boolean;
  /** The record that confirms it (absent when not done). */
  source?: string;
  /** It was already claimed before this check (no new confirmation). */
  claimed: boolean;
}

/**
 * The missions of the day checked in slot order. A mission already in the ledger stays done with its source; an open
 * mission takes its first candidate that no other mission of the day has used. Returns the checks and the ledger to keep
 * (the same ledger when nothing new was confirmed). Pure and repeatable: the same data and ledger give the same answer.
 */
export function checkMissions(ids: MissionId[], data: MissionData, day: string, ledger?: MissionLedger | null): { checks: MissionCheck[]; ledger: MissionLedger } {
  const claims: Partial<Record<MissionId, string>> = ledger && ledger.day === day ? { ...ledger.claims } : {};
  const used = new Set(Object.values(claims));
  const checks: MissionCheck[] = [];
  for (const id of ids) {
    const had = claims[id];
    if (had) {
      checks.push({ id, done: true, source: had, claimed: true });
      continue;
    }
    const pick = candidateSources(id, data, day).find((s) => !used.has(s));
    if (pick) {
      claims[id] = pick;
      used.add(pick);
      checks.push({ id, done: true, source: pick, claimed: false });
    } else {
      checks.push({ id, done: false, claimed: false });
    }
  }
  const changed = !ledger || ledger.day !== day || Object.keys(claims).length !== Object.keys(ledger.claims).length;
  return { checks, ledger: changed ? { day, claims } : ledger };
}
