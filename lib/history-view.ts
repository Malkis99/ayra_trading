/**
 * The History tab (docs/quest-hub-plan.md, 4.3): 12 weeks of days and honest figures over them. Built only from what is
 * saved — the same day views as the Week tab (lib/week-view.ts, day snapshots of QH-3), the history and the day
 * statistics. A figure that cannot be counted correctly is `null`, never estimated. Read-only.
 */
import { addDaysToKey, mondayOfKey } from "./day-key";
import { weekView, type WeekDayView } from "./week-view";
import type { GameState } from "./game";

export const HISTORY_WEEKS = 12;

type HistoryState = Parameters<typeof weekView>[0] & Pick<GameState, "currentStreak" | "bestStreak">;

/** The last `weeks` weeks ending with the current one, oldest first; each week Monday … Sunday. */
export function historyMap(state: HistoryState, today: string, weeks = HISTORY_WEEKS): WeekDayView[][] {
  const current = mondayOfKey(today);
  return Array.from({ length: weeks }, (_, i) => weekView(state, addDaysToKey(current, -7 * (weeks - 1 - i)), today));
}

export interface HistoryStats {
  from: string;
  to: string;
  /** Days of the period that have begun on this account (today included). */
  days: number;
  /** Days with at least one quest done. */
  active: number;
  /** Days with a day snapshot (exact data: missions, mode, replacements). */
  snapshotDays: number;
  /** Days with records but no snapshot (before QH-3): only the history is known. */
  partialDays: number;
  /** The first day with a snapshot in the period (from then on missions are counted). */
  snapshotsFrom: string | null;
  /** Days with every mission done — on snapshot days with missions only; null without such days. */
  full: { done: number; of: number } | null;
  /** Missions done of missions offered — on snapshot days only; null without them. */
  core: { done: number; of: number } | null;
  xp: number;
  coins: number;
  restDays: number;
  /** Shields spent in the period (the day statistics and the snapshots). */
  shieldsUsed: number;
}

/** Figures of the period (the map's days): counted, never guessed. */
export function historyStats(state: HistoryState, map: WeekDayView[][]): HistoryStats {
  const all = map.flat();
  const begun = all.filter((d) => d.status !== "future" && d.status !== "beforeStart");
  const snaps = new Map((state.questDays || []).map((s) => [s.day, s]));
  const snapDays = begun.filter((d) => d.source === "snapshot");
  const withCore = snapDays.filter((d) => d.core && d.core.total > 0);
  const shieldDays = new Set<string>();
  for (const d of begun) {
    if (state.dailyStats?.[d.key]?.shieldUsed || snaps.get(d.key)?.shieldUsed) shieldDays.add(d.key);
  }
  return {
    from: all[0].key,
    to: all[all.length - 1].key,
    days: begun.length,
    active: begun.filter((d) => d.quests > 0).length,
    snapshotDays: snapDays.length,
    partialDays: begun.filter((d) => d.source === "history" && !d.isToday).length,
    snapshotsFrom: snapDays.length ? snapDays[0].key : null,
    full: withCore.length ? { done: withCore.filter((d) => d.core!.done === d.core!.total).length, of: withCore.length } : null,
    core: withCore.length ? { done: withCore.reduce((n, d) => n + d.core!.done, 0), of: withCore.reduce((n, d) => n + d.core!.total, 0) } : null,
    xp: begun.reduce((n, d) => n + d.xp, 0),
    coins: begun.reduce((n, d) => n + d.coins, 0),
    restDays: begun.filter((d) => d.status === "rest").length,
    shieldsUsed: shieldDays.size,
  };
}

/** How strong a day looks on the map: by the quests actually saved (no score, no penalty for an empty day). */
export type MapLook = "high" | "mid" | "low" | "rest" | "shield" | "none" | "noData" | "beforeStart" | "future" | "today";

export function mapLook(d: WeekDayView): MapLook {
  if (d.status === "done") {
    // a snapshot day with missions: by missions done; otherwise by quests in the history
    if (d.core && d.core.total > 0) return d.core.done >= d.core.total ? "high" : d.core.done >= 2 ? "mid" : "low";
    return d.quests >= 3 ? "high" : d.quests === 2 ? "mid" : "low";
  }
  return d.status;
}

/** The day a History opens on: the requested day of the period (not a future one), else the last day with records. */
export function historyDefaultDay(map: WeekDayView[][], requested: string | null | undefined): string {
  const all = map.flat();
  if (requested && all.some((d) => d.key === requested && d.status !== "future")) return requested;
  const past = [...all].reverse().find((d) => !d.isToday && d.status !== "future" && d.status !== "beforeStart" && d.source !== "none");
  return (past || all.find((d) => d.isToday) || all[0]).key;
}
