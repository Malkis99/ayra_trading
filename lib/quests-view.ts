/**
 * What the Quests page shows, computed only from saved data (docs/quests-2.0-plan.md, Q1): no invented numbers.
 * Quests per day come from the quest history (`history`, one entry per completed quest); rest days and shields from
 * `dailyStats`. Journal XP events are not counted as quests.
 */
import type { GameState } from "./game";
import { addDaysToKey, mondayOfKey } from "./day-key";
import { APP_CLOSED_QUESTS, QUEST_POOL, getTodaysQuests, type QuestTemplate } from "./quests";
import type { DayMode, ReasonKey } from "./quest-engine";

export type DayStatus = "done" | "rest" | "shield" | "none" | "noData" | "today" | "future" | "beforeStart";

export interface DayCell {
  key: string;
  quests: number;
  status: DayStatus;
  isToday: boolean;
}

type ViewState = Pick<
  GameState,
  "history" | "dailyStats" | "createdAt" | "isRestDay" | "completedQuestsToday" | "passedQuestsToday" | "questReplacements" | "lastRewardClaimDate" | "questDay"
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

/** The saved set of the game day (Q2) with the day's swaps; the same set on Quests, Home and Profile. */
export function todaysQuests(state: Pick<ViewState, "questReplacements" | "questDay">, today: string) {
  const stored = state.questDay && state.questDay.day === today ? state.questDay : null;
  return getTodaysQuests(today, state.questReplacements || {}, stored);
}

export type NextStep =
  | { kind: "rest" }
  | { kind: "quest"; quest: QuestTemplate }
  | { kind: "journal"; quest: QuestTemplate; href: string }
  | { kind: "done" };

/** A block of the journal's day plan that a link opens and scrolls to (`/journal?tab=plan&focus=…`). */
export type PlanFocus = "bias" | "levels" | "events" | "limits" | "checklist" | "review";

export const planHref = (focus: PlanFocus) => `/journal?tab=plan&focus=${focus}`;

/** Where the journal closes each quest the app checks: straight to the field that closes it. */
export const JOURNAL_LINK: Record<string, string> = {
  q_tradelog: "/journal?tab=trades",
  q_bias: planHref("bias"),
  q_riskcheck: planHref("limits"),
  q_reflect: planHref("review"),
};

/** The exact place for a journal quest, from why it is still open (risk: limits first, then the «limits checked» item). */
export function journalHref(questId: string, reason?: ReasonKey | null): string {
  if (questId === "q_riskcheck" && reason === "riskNotChecked") return planHref("checklist");
  return JOURNAL_LINK[questId] || "/journal";
}

/** Self-reported quests that belong to the evening: never the first suggestion of a day. */
const EVENING_QUESTS: ReadonlySet<string> = new Set(["q_sleep_prep"]);
/** Journal steps of the morning protocol (trading days). */
const PREPARATION: readonly string[] = ["q_bias", "q_riskcheck"];

/**
 * The one useful next action of the active mode: the day's preparation in the journal first (trading), then the core
 * quests, then the day review, and evening habits last. Never a quest put off for today.
 */
export function nextStep(state: ViewState, core: QuestTemplate[], mode: DayMode = "trading", reasonOf?: (questId: string) => ReasonKey | null): NextStep {
  if (state.isRestDay || mode === "rest") return { kind: "rest" };
  const open = (id: string) => !state.completedQuestsToday[id] && !state.passedQuestsToday[id];
  const tpl = (id: string) => core.find((q) => q.id === id) || QUEST_POOL.find((q) => q.id === id);
  const reviewOpen = open("q_reflect") && (mode === "trading" || mode === "study" || core.some((q) => q.id === "q_reflect"));
  const order: string[] = [
    ...(mode === "trading" ? PREPARATION.filter(open) : []),
    ...core.filter((q) => open(q.id) && q.id !== "q_reflect" && !EVENING_QUESTS.has(q.id)).map((q) => q.id),
    ...(reviewOpen ? ["q_reflect"] : []),
    ...core.filter((q) => open(q.id) && EVENING_QUESTS.has(q.id)).map((q) => q.id),
  ];
  const id = order.find((x) => !!tpl(x));
  const quest = id ? tpl(id) : undefined;
  if (!quest) return { kind: "done" };
  if (APP_CLOSED_QUESTS.has(quest.id)) return { kind: "journal", quest, href: journalHref(quest.id, reasonOf?.(quest.id)) };
  return { kind: "quest", quest };
}

/** A quest of the history: checked by the journal or ticked by the person. */
export function historySource(questId: string): "journal" | "self" {
  return APP_CLOSED_QUESTS.has(questId) ? "journal" : "self";
}
