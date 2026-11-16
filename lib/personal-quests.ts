/**
 * QH-8.1 Personal Quests / «My path» — the model only (docs/quest-hub-qh8-spec.md).
 *
 * NOT WIRED: nothing in the game state, the store or the UI imports this module yet. It gives no XP and no Coins; the
 * rates below are the owner's preliminary model for the economy simulation and are not approved (owner decision
 * 2026-11-17: no new XP before the final rates are approved).
 *
 * A personal quest is a 30-day run of one measurable daily action. Daily marks give nothing; after the period ends and
 * the final report is written, the run gets a completion rank by its confirmed days, and — only then, once per run — a
 * reward (proposed). Each category has its own achievement with Bronze, Silver and Gold; a better run raises it, a
 * repeated or worse run never lowers it or adds a duplicate.
 */

import { addDaysToKey } from "./day-key";

/* ------------------------------------------------------------------ categories (an extensible registry) */

export type PQCategoryId = "discipline" | "physical" | "learning" | "psychology" | "trading" | "habits";

/**
 * How a day of the run is confirmed:
 * - app: a record saved in AYRA that day passes the category's check (the Quest Hub mission checks);
 * - self: the person's own mark — always shown as a self-report, never as a verified fact.
 */
export type PQVerification = "app" | "self";

export interface PQCategory {
  id: PQCategoryId;
  /** lucide-react icon name (resolved by the UI). */
  icon: string;
  /** The ways a day can be confirmed in this category (the first is the default). */
  verification: readonly PQVerification[];
  /** Which saved records confirm a day (app): ids of the existing Quest Hub mission checks. Never trades or risk. */
  appChecks: readonly string[];
}

/** Dictionary keys: `personalQuests.categories.<id>.{name,description}` and `personalQuests.achievements.<id>.{name,description}`. */
export const PQ_CATEGORIES: readonly PQCategory[] = [
  { id: "discipline", icon: "ShieldCheck", verification: ["app", "self"], appChecks: ["q_bias", "q_riskcheck", "m_plan_tomorrow"] },
  { id: "physical", icon: "Dumbbell", verification: ["self"], appChecks: [] },
  { id: "learning", icon: "GraduationCap", verification: ["app", "self"], appChecks: ["m_lesson", "m_backtest", "m_observation"] },
  { id: "psychology", icon: "Brain", verification: ["app", "self"], appChecks: ["m_day_state", "m_mistake", "q_reflect"] },
  { id: "trading", icon: "LineChart", verification: ["app"], appChecks: ["q_bias", "q_reflect", "m_trade_review"] },
  { id: "habits", icon: "Repeat", verification: ["self"], appChecks: [] },
];

export const categoryOf = (id: string): PQCategory | undefined => PQ_CATEGORIES.find((c) => c.id === id);

/* ------------------------------------------------------------------ the run */

export const PQ_PERIOD_DAYS = 30;
/** At most this many personal quests are active at a time. */
export const PQ_MAX_ACTIVE = 3;
/** Shortest own text of the final report (as a session review note, MISSION_TEXT_MIN.sessionNote). */
export const PQ_REPORT_MIN = 80;

export type PQRank = "bronze" | "silver" | "gold";
export const PQ_RANKS: readonly PQRank[] = ["bronze", "silver", "gold"];
/** Confirmed days needed for each rank (fewer than Bronze: completed without a reward, the history is kept). */
export const PQ_RANK_DAYS: Record<PQRank, number> = { bronze: 21, silver: 25, gold: 29 };

/** PRELIMINARY — the owner's model for the simulation only; not approved, not used by the game. */
export const PROPOSED_RANK_XP: Record<PQRank, number> = { bronze: 100, silver: 180, gold: 250 };

export function rankFor(confirmedDays: number): PQRank | null {
  if (confirmedDays >= PQ_RANK_DAYS.gold) return "gold";
  if (confirmedDays >= PQ_RANK_DAYS.silver) return "silver";
  if (confirmedDays >= PQ_RANK_DAYS.bronze) return "bronze";
  return null;
}

export interface PQMark {
  /** The game day the mark is for. */
  day: string;
  /** When it was saved (ISO). */
  at: string;
  /** The game day it was saved on (a mark counts only when saved on its own day: no backfilling). */
  savedOn: string;
  source: PQVerification;
  /** app: the record that confirmed it (one record confirms one day of one run). */
  sourceKey?: string;
  note?: string;
}

export type PQStatus = "active" | "awaitingReport" | "completed" | "abandoned";

export interface PQRun {
  /** This run (a repeat of a quest is a new run with a new id). */
  id: string;
  /** The quest it belongs to (repeats share it). */
  questId: string;
  category: PQCategoryId;
  title: string;
  goal: string;
  dailyAction: string;
  startState: string;
  expectedResult: string;
  verification: PQVerification;
  /** First game day of the period; the period is 30 game days. */
  startDay: string;
  marks: PQMark[];
  status: PQStatus;
  report?: { at: string; text: string };
}

export const endDayOf = (run: Pick<PQRun, "startDay">) => addDaysToKey(run.startDay, PQ_PERIOD_DAYS - 1);

/**
 * Days that count: inside the period, saved on their own game day, one per day. An app mark needs its source; a
 * self mark counts as a self-report (the history says so). Late, early or repeated marks stay in the diary but do not count.
 */
export function confirmedDays(run: Pick<PQRun, "startDay" | "marks" | "verification">): number {
  const end = endDayOf(run);
  const days = new Set<string>();
  for (const m of run.marks) {
    if (m.day < run.startDay || m.day > end || m.savedOn !== m.day) continue;
    if (m.source !== run.verification) continue;
    if (m.source === "app" && !m.sourceKey) continue;
    days.add(m.day);
  }
  return days.size;
}

/** The run's state on `today` (the period is over the day after its last day). */
export function phaseOf(run: PQRun, today: string): PQStatus {
  if (run.status === "abandoned" || run.status === "completed") return run.status;
  return today > endDayOf(run) ? "awaitingReport" : "active";
}

/* ------------------------------------------------------------------ starting a run */

export type StartFailure = "maxActive" | "sameQuestActive" | "unknownCategory" | "verificationNotAllowed" | "missingFields";

/**
 * A new run may start when fewer than 3 runs are active, the same quest has no active run (a repeat starts only after
 * the previous run ended), the category exists and allows the chosen verification, and every field is filled.
 */
export function canStart(runs: PQRun[], next: Pick<PQRun, "questId" | "category" | "verification" | "title" | "goal" | "dailyAction">, today: string): StartFailure | null {
  const cat = categoryOf(next.category);
  if (!cat) return "unknownCategory";
  if (!cat.verification.includes(next.verification)) return "verificationNotAllowed";
  if (![next.title, next.goal, next.dailyAction].every((x) => typeof x === "string" && x.trim().length > 0)) return "missingFields";
  const active = runs.filter((r) => phaseOf(r, today) === "active" || phaseOf(r, today) === "awaitingReport");
  if (active.length >= PQ_MAX_ACTIVE) return "maxActive";
  if (active.some((r) => r.questId === next.questId)) return "sameQuestActive";
  return null;
}

/* ------------------------------------------------------------------ settling a run (proposed rewards) */

/** One paid run in the reward ledger (append-only; the key is the run id). */
export interface PQLedgerEntry {
  runId: string;
  questId: string;
  category: PQCategoryId;
  rank: PQRank | null;
  days: number;
  xp: number;
  /** The game day the run was settled. */
  day: string;
  at: string;
  verification: PQVerification;
}

export type SettleFailure = "periodNotOver" | "reportMissing" | "reportShort" | "abandoned" | "alreadySettled";

/**
 * The final step: only after the period is over and with a final report of 80+ own characters, once per run.
 * The rank comes from the confirmed days; the reward from the given rates (the simulation's PROPOSED_RANK_XP — nothing
 * in the game uses it). Fewer than 21 days: settled with no rank and no reward, kept in the history.
 */
export function settleRun(
  run: PQRun,
  ledger: readonly PQLedgerEntry[],
  report: string,
  today: string,
  at: string,
  rates: Record<PQRank, number> = PROPOSED_RANK_XP
): { entry: PQLedgerEntry } | { failure: SettleFailure } {
  if (run.status === "abandoned") return { failure: "abandoned" };
  if (ledger.some((e) => e.runId === run.id) || run.status === "completed") return { failure: "alreadySettled" };
  if (today <= endDayOf(run)) return { failure: "periodNotOver" };
  const text = (report || "").trim();
  if (!text) return { failure: "reportMissing" };
  if (text.length < PQ_REPORT_MIN) return { failure: "reportShort" };
  const days = confirmedDays(run);
  const rank = rankFor(days);
  return { entry: { runId: run.id, questId: run.questId, category: run.category, rank, days, xp: rank ? rates[rank] : 0, day: today, at, verification: run.verification } };
}

/* ------------------------------------------------------------------ category achievements */

/** The achievement tier of each category: the best rank ever settled (never lowered, never duplicated). */
export type PQAchievements = Partial<Record<PQCategoryId, { rank: PQRank; runId: string; day: string }>>;

const RANK_ORDER: Record<PQRank, number> = { bronze: 1, silver: 2, gold: 3 };

/** A settled run raises its category's tier only when its rank is higher; otherwise nothing changes. */
export function withAchievement(current: PQAchievements, entry: PQLedgerEntry): { next: PQAchievements; upgraded: boolean } {
  if (!entry.rank) return { next: current, upgraded: false };
  const had = current[entry.category];
  if (had && RANK_ORDER[had.rank] >= RANK_ORDER[entry.rank]) return { next: current, upgraded: false };
  return { next: { ...current, [entry.category]: { rank: entry.rank, runId: entry.runId, day: entry.day } }, upgraded: true };
}
