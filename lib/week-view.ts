/**
 * The interactive week (docs/quest-hub-plan.md, 4.2): what each day of any week shows and what a day panel opens.
 * Read-only: built from the saved day snapshots (QH-3), the history and the day statistics. Nothing is invented — a day
 * without a snapshot shows only what the history kept, and says so; a day without any record shows «no records».
 */
import { addDaysToKey, mondayOfKey } from "./day-key";
import { APP_CLOSED_QUESTS } from "./quests";
import { dayCell, type DayStatus } from "./quests-view";
import type { DaySnapshot, WeekSnapshot } from "./day-snapshots";
import type { DayMode } from "./quest-engine";
import type { GameState } from "./game";

type WeekState = Pick<
  GameState,
  "history" | "dailyStats" | "createdAt" | "isRestDay" | "completedQuestsToday" | "passedQuestsToday" | "questReplacements" | "lastRewardClaimDate" | "questDay" | "questDays" | "questWeeks"
>;

export interface WeekDayView {
  key: string;
  isToday: boolean;
  /** The same status as the activity map (done, rest, shield, none, noData, today, future, beforeStart). */
  status: DayStatus;
  /** Where the day comes from: its snapshot, only the history (before snapshots), or nothing. */
  source: "snapshot" | "history" | "none";
  mode?: DayMode;
  /** Missions done of the missions offered (snapshot days with missions only). */
  core?: { done: number; total: number };
  quests: number;
  xp: number;
  coins: number;
}

export type HistoryEntry = GameState["history"][number];

export type DayDetail =
  | { kind: "future"; key: string }
  | { kind: "today"; key: string }
  | { kind: "beforeStart"; key: string }
  | { kind: "empty"; key: string; shieldUsed: boolean }
  | { kind: "snapshot"; key: string; snap: DaySnapshot; entries: HistoryEntry[] }
  | { kind: "history"; key: string; entries: HistoryEntry[]; xp: number; coins: number; restDay: boolean; shieldUsed: boolean; selfXp: number };

const snapshotOf = (state: WeekState, key: string) => (state.questDays || []).find((d) => d.day === key);
const entriesOf = (state: WeekState, key: string) =>
  (state.history || []).filter((h) => (h.completedAt || "").slice(0, 10) === key).sort((a, b) => (a.at || "").localeCompare(b.at || ""));

/** The seven days of the week that starts on `weekStart` (a Monday). */
export function weekView(state: WeekState, weekStart: string, today: string): WeekDayView[] {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(weekStart, i);
    const cell = dayCell(state, key, today);
    const snap = cell.status === "future" ? undefined : snapshotOf(state, key);
    const stat = state.dailyStats?.[key];
    const view: WeekDayView = {
      key,
      isToday: cell.isToday,
      status: cell.status,
      source: snap ? "snapshot" : cell.quests > 0 || stat ? "history" : "none",
      quests: cell.quests,
      xp: snap ? snap.totals.xp : stat?.xpGained || 0,
      coins: snap ? snap.totals.coins : stat?.coinsGained || 0,
    };
    if (snap?.mode) view.mode = snap.mode;
    if (snap && snap.core.length > 0) view.core = { done: snap.core.filter((id) => !!snap.done[id]).length, total: snap.core.length };
    // a snapshot of a rest day is a rest day even when another quest was done
    if (snap?.restDay && view.status === "done" && snap.mode === "rest") view.status = "rest";
    if (cell.isToday) view.source = "none";
    return view;
  });
}

export interface WeekSummary {
  /** Days with at least one quest, of the days of the week that have begun. */
  active: number;
  elapsed: number;
  /** Days with every mission done — counted on snapshot days only (null when the week has none). */
  full: number | null;
  fullOf: number;
  xp: number;
  coins: number;
}

export function weekSummary(days: WeekDayView[]): WeekSummary {
  const begun = days.filter((d) => d.status !== "future" && d.status !== "beforeStart");
  const withCore = days.filter((d) => d.core);
  return {
    active: begun.filter((d) => d.quests > 0).length,
    elapsed: begun.length,
    full: withCore.length ? withCore.filter((d) => d.core!.done === d.core!.total).length : null,
    fullOf: withCore.length,
    xp: begun.reduce((n, d) => n + d.xp, 0),
    coins: begun.reduce((n, d) => n + d.coins, 0),
  };
}

/** What a day panel shows (read-only). */
export function dayDetail(state: WeekState, key: string, today: string): DayDetail {
  if (key > today) return { kind: "future", key };
  if (key === today) return { kind: "today", key };
  const created = (state.createdAt || "").slice(0, 10);
  const entries = entriesOf(state, key);
  const snap = snapshotOf(state, key);
  if (snap) return { kind: "snapshot", key, snap, entries };
  if (created && key < created && entries.length === 0) return { kind: "beforeStart", key };
  const stat = state.dailyStats?.[key];
  if (entries.length === 0 && !stat) return { kind: "empty", key, shieldUsed: false };
  if (entries.length === 0 && !stat?.xpGained && !stat?.coinsGained && !stat?.isRestDay) return { kind: "empty", key, shieldUsed: !!stat?.shieldUsed };
  return {
    kind: "history",
    key,
    entries,
    xp: stat?.xpGained || 0,
    coins: stat?.coinsGained || 0,
    restDay: !!stat?.isRestDay,
    shieldUsed: !!stat?.shieldUsed,
    selfXp: entries.reduce((n, h) => (APP_CLOSED_QUESTS.has(h.questId) ? n : n + (h.xp || 0)), 0),
  };
}

/** The first week that can be opened: the week the account started (or of its oldest record), never after today. */
export function earliestWeek(state: WeekState, today: string): string {
  let first = (state.createdAt || today).slice(0, 10);
  for (const h of state.history || []) if (h.completedAt && h.completedAt < first) first = h.completedAt.slice(0, 10);
  for (const d of state.questDays || []) if (d.day < first) first = d.day;
  return mondayOfKey(first > today ? today : first);
}

/** A week key from the address: a valid Monday between the first week and the current one, else the current week. */
export function clampWeek(raw: string | null | undefined, first: string, current: string): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return current;
  const monday = mondayOfKey(raw);
  if (monday > current) return current;
  if (monday < first) return first;
  return monday;
}

/** The day a week opens on: the given day of that week, else today (current week), else its last day with records. */
export function defaultDay(days: WeekDayView[], requested: string | null | undefined): string {
  if (requested && days.some((d) => d.key === requested && d.status !== "future")) return requested;
  const today = days.find((d) => d.isToday);
  if (today) return today.key;
  const withData = [...days].reverse().find((d) => d.source !== "none" && d.status !== "future" && d.status !== "beforeStart");
  return (withData || days.find((d) => d.status !== "future") || days[0]).key;
}

/** The saved snapshot of a closed week (challenge and its result), if any. */
export const weekSnapshotOf = (state: WeekState, week: string): WeekSnapshot | undefined => (state.questWeeks || []).find((w) => w.week === week);
