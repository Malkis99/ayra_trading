/**
 * QH-7: the week challenge as a full cycle — the days of the week, the time left, the phase, and a trophy for a won week.
 * Built on what already exists (QH-3): the challenge is chosen once a week (`questWeek`), its result is written once
 * into the closed week's snapshot (`questWeeks[].bossResult`). Nothing here computes a new rule or gives XP or Coins:
 * a trophy is a lasting copy of a result that was already recorded as «met».
 */

import { addDaysToKey, dayKeyInZone, weekdayOfKey } from "./day-key";
import { bossConditions, bossState, prepActiveDay, type BossId, type CheckState, type JournalSnapshot } from "./quest-engine";
import type { WeekSnapshot } from "./day-snapshots";

export const TROPHY_VERSION = 1;

export interface WeekTrophy {
  v: 1;
  /** Monday of the won week (game days). */
  week: string;
  boss: BossId;
  /** When the result was recorded (the result's own time, never the time this copy was made). */
  at: string;
  /** The recorded conditions, as they were (for «stop in 5 of 5 trades»). */
  conditions: Array<{ key: string; source: "auto" | "self"; done: number; total: number }>;
}

type Result = NonNullable<WeekSnapshot["bossResult"]>;

const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A trophy for a recorded result — only for a met one. */
export function trophyFor(week: string, boss: BossId, result: Result): WeekTrophy | null {
  if (result.state !== "met") return null;
  return { v: TROPHY_VERSION, week, boss, at: result.at, conditions: result.conditions.map((c) => ({ key: c.key, source: c.source, done: c.done, total: c.total })) };
}

/** One trophy per week: an existing one is never replaced (a second tab, a reload or a repeated check add nothing). */
export function withWeekTrophy(list: WeekTrophy[] | undefined, trophy: WeekTrophy | null): WeekTrophy[] | null {
  const current = list || [];
  if (!trophy || current.some((t) => t.week === trophy.week)) return null;
  return sortTrophies([trophy, ...current]);
}

/**
 * Wins recorded before trophies existed: a closed week whose result was already written as «met» (by the journal, at
 * that time) gets its trophy. Nothing is recomputed — a week without a written result gets nothing.
 */
export function trophiesFromWeeks(list: WeekTrophy[] | undefined, weeks: WeekSnapshot[] | undefined): WeekTrophy[] {
  let next = list || [];
  for (const w of weeks || []) {
    if (!w.boss || !w.bossResult) continue;
    next = withWeekTrophy(next, trophyFor(w.week, w.boss, w.bossResult)) || next;
  }
  return next;
}

export function sortTrophies(list: WeekTrophy[]): WeekTrophy[] {
  return list.slice().sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
}

/** Saved trophies: anything that is not a valid trophy is dropped (never guessed); one per week. */
export function readWeekTrophies(raw: unknown): WeekTrophy[] {
  if (!Array.isArray(raw)) return [];
  const out: WeekTrophy[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const t = r as Partial<WeekTrophy>;
    if (!isKey(t.week) || typeof t.boss !== "string" || typeof t.at !== "string" || !Array.isArray(t.conditions)) continue;
    if (out.some((x) => x.week === t.week)) continue;
    out.push({ v: TROPHY_VERSION, week: t.week, boss: t.boss as BossId, at: t.at, conditions: t.conditions.filter((c) => c && typeof c.key === "string") });
  }
  return sortTrophies(out);
}

/* ------------------------------------------------------------------ the current week */

export type ChallengeDayState = "future" | "noTrades" | "met" | "notMet" | "insufficientData";

/**
 * Each day of the week by the same conditions, on that day's trades only. A day without trades is «no trades» —
 * never a failure (rest, study and analysis days are full days of the week).
 */
export function challengeDays(boss: BossId, snap: JournalSnapshot, week: string, today: string): Array<{ key: string; state: ChallengeDayState; trades: number }> {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(week, i);
    if (key > today) return { key, state: "future" as const, trades: 0 };
    // «Preparation week» (QH-7.1): a day is active by confirmed journal work, whatever the trades
    if (boss === "preparationWeek") return { key, state: (prepActiveDay(snap, key) ? "met" : "noTrades") as ChallengeDayState, trades: 0 };
    const trades = (snap.trades || []).filter((t) => !t.deletedAt && dayOf(t.openedAt, snap.timezone) === key);
    if (trades.length === 0) return { key, state: "noTrades" as const, trades: 0 };
    const state = bossState(bossConditions(boss, { ...snap, trades }, key));
    return { key, state: (state === "met" || state === "notMet" || state === "insufficientData" ? state : "noTrades") as ChallengeDayState, trades: trades.length };
  });
}

// the same day rule as the engine: a trade belongs to the day it was opened, in the account zone
const dayOf = (iso: string, tz?: string) => dayKeyInZone(new Date(iso), tz);

/** The phase of the current week's challenge: «active» or «condition met (so far)». */
export type CurrentPhase = "active" | "conditionMet";
export const currentPhase = (overall: CheckState): CurrentPhase => (overall === "met" ? "conditionMet" : "active");

/** The phase of a closed week: checking (result not written yet), completed (won), not completed, or not applicable. */
export type ClosedPhase = "checking" | "completed" | "notCompleted" | "notApplicable" | "none";
export function closedPhase(snap: WeekSnapshot | undefined): ClosedPhase {
  if (!snap || !snap.boss) return "none";
  if (!snap.bossResult) return "checking";
  const s = snap.bossResult.state;
  return s === "met" ? "completed" : s === "notMet" ? "notCompleted" : "notApplicable";
}

/**
 * Minutes left until the week ends (Monday 00:00 in the account zone) for the game day `today`. When the device clock
 * is behind the game day (the game day never goes back), the end of the game day's week is still the end.
 */
export function weekMinutesLeft(now: Date, today: string, tz?: string): number {
  let minutes = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
    minutes = h * 60 + m;
  } catch {
    minutes = now.getHours() * 60 + now.getMinutes();
  }
  const daysAfter = 6 - weekdayOfKey(today);
  return Math.max(0, daysAfter * 1440 + (1440 - minutes));
}
