/**
 * What the Quests page shows, computed only from saved data (docs/quests-2.0-plan.md, Q1): no invented numbers.
 * Quests per day come from the quest history (`history`, one entry per completed quest); rest days and shields from
 * `dailyStats`. Journal XP events are not counted as quests.
 */
import type { GameState } from "./game";
import { addDaysToKey, mondayOfKey } from "./day-key";
import { APP_CLOSED_QUESTS, getTodaysQuests, type QuestTemplate } from "./quests";

export type DayStatus = "done" | "rest" | "shield" | "none" | "noData" | "today" | "future" | "beforeStart";

export interface DayCell {
  key: string;
  quests: number;
  status: DayStatus;
  isToday: boolean;
}

type ViewState = Pick<
  GameState,
  "history" | "dailyStats" | "createdAt" | "isRestDay" | "completedQuestsToday" | "passedQuestsToday" | "questReplacements" | "lastRewardClaimDate"
>;

function questsByDay(history: GameState["history"]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of history || []) {
    if (!h?.completedAt) continue;
    const k = h.completedAt.slice(0, 10);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function dayCell(state: ViewState, key: string, today: string, counts = questsByDay(state.history)): DayCell {
  const quests = counts.get(key) || 0;
  const rec = state.dailyStats?.[key];
  const isToday = key === today;
  const created = (state.createdAt || "").slice(0, 10);
  let status: DayStatus;
  if (key > today) status = "future";
  else if (created && key < created) status = "beforeStart";
  else if (quests > 0) status = "done";
  else if (isToday ? state.isRestDay : rec?.isRestDay) status = "rest";
  else if (rec?.shieldUsed) status = "shield";
  else if (isToday) status = "today";
  else if (rec) status = "none"; // the day has a record (for example journal XP), but no quest
  else status = "noData";
  return { key, quests, status, isToday };
}

/** Monday … Sunday of the week that contains the game day. */
export function weekDays(state: ViewState, today: string): DayCell[] {
  const monday = mondayOfKey(today);
  const counts = questsByDay(state.history);
  return Array.from({ length: 7 }, (_, i) => dayCell(state, addDaysToKey(monday, i), today, counts));
}

/** `weeks` rows of Monday … Sunday ending with the current week (the oldest week first). */
export function activityGrid(state: ViewState, today: string, weeks = 4): DayCell[][] {
  const monday = mondayOfKey(today);
  const counts = questsByDay(state.history);
  return Array.from({ length: weeks }, (_, w) => {
    const start = addDaysToKey(monday, -7 * (weeks - 1 - w));
    return Array.from({ length: 7 }, (_, d) => dayCell(state, addDaysToKey(start, d), today, counts));
  });
}

/** Quests completed this week (Monday … today), from the history. */
export function weekQuestCount(state: ViewState, today: string): number {
  return weekDays(state, today).reduce((n, d) => n + (d.key <= today ? d.quests : 0), 0);
}

/** XP and coins of today from quests and journal actions (`dailyStats`; one-time rewards are not part of it). */
export function todayEarned(state: ViewState, today: string): { xp: number; coins: number } {
  const rec = state.dailyStats?.[today];
  return { xp: rec?.xpGained || 0, coins: rec?.coinsGained || 0 };
}

export function todaysQuests(state: ViewState, today: string) {
  return getTodaysQuests(today, state.questReplacements || {});
}

export type NextStep =
  | { kind: "rest" }
  | { kind: "quest"; quest: QuestTemplate }
  | { kind: "journal"; quest: QuestTemplate; href: string }
  | { kind: "done" };

/** Where the journal closes each quest the app checks. */
export const JOURNAL_LINK: Record<string, string> = {
  q_tradelog: "/journal?tab=trades",
  q_bias: "/journal?tab=plan",
  q_riskcheck: "/journal?tab=plan",
  q_reflect: "/journal?tab=plan",
};

/** The one useful next action: the first open core quest (a self-reported one, or the journal for app-checked ones). */
export function nextStep(state: ViewState, core: QuestTemplate[]): NextStep {
  if (state.isRestDay) return { kind: "rest" };
  const open = core.find((q) => !state.completedQuestsToday[q.id] && !state.passedQuestsToday[q.id]);
  if (!open) return { kind: "done" };
  if (APP_CLOSED_QUESTS.has(open.id)) return { kind: "journal", quest: open, href: JOURNAL_LINK[open.id] || "/journal" };
  return { kind: "quest", quest: open };
}

/** A quest of the history: checked by the journal or ticked by the person. */
export function historySource(questId: string): "journal" | "self" {
  return APP_CLOSED_QUESTS.has(questId) ? "journal" : "self";
}
