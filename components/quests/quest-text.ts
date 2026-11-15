import type { LucideIcon } from "lucide-react";
import { Activity, BarChart2, Brain, CheckSquare, Smile, Sun, Users } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/types";
import type { QuestCategory, QuestTemplate } from "@/lib/quests";

type Lang = "ru" | "en";

/** Title of a quest in the current language (dictionary first, then the template's own text). */
export function questTitle(dict: Dictionary, lang: Lang, q: Pick<QuestTemplate, "id" | "fallbackTitleRu" | "fallbackTitleEn">): string {
  const t = (dict.questTemplates as Record<string, { title: string; why: string } | undefined>)[q.id];
  return t?.title || (lang === "ru" ? q.fallbackTitleRu : q.fallbackTitleEn);
}

export function questWhy(dict: Dictionary, lang: Lang, q: Pick<QuestTemplate, "id" | "fallbackWhyRu" | "fallbackWhyEn">): string {
  const t = (dict.questTemplates as Record<string, { title: string; why: string } | undefined>)[q.id];
  return t?.why || (lang === "ru" ? q.fallbackWhyRu : q.fallbackWhyEn);
}

/**
 * Title of a history entry (QH-6.5: the same short name as on «Today», «Week» and «History»): the short name, then the
 * dictionary title, else the title saved at that time. The saved entry itself is never changed.
 */
export function historyTitle(dict: Dictionary, questId: string, saved: string): string {
  const short = (dict.questsPage.q2.short as Record<string, string | undefined>)[questId];
  const t = (dict.questTemplates as Record<string, { title: string } | undefined>)[questId];
  return short || t?.title || saved;
}

/** Which journal record confirms a verifiable mission (shown on its row), or undefined for other quests. */
export function missionSourceLabel(dict: Dictionary, questId: string): string | undefined {
  return (dict.questsPage.q2.missionSource as Record<string, string | undefined>)[questId];
}

/** Category look on this page: calm tones, no gold (gold is for achievements and rare items only). */
export const CATEGORY_LOOK: Record<QuestCategory, { color: string; icon: LucideIcon }> = {
  Trading: { color: "#7fb8e6", icon: BarChart2 },
  Discipline: { color: "#a38ad1", icon: CheckSquare },
  Psychology: { color: "#c3a6f0", icon: Brain },
  Physical: { color: "#7fcfa6", icon: Activity },
  Mental: { color: "#9fb4f0", icon: Smile },
  Social: { color: "#e0a6c8", icon: Users },
  Lifestyle: { color: "#b9a3e0", icon: Sun },
};

/** Short title of a quest on the Quest Hub rows (owner decision В5: the task, reward and check stay the same). */
export function questShortTitle(dict: Dictionary, lang: Lang, q: Pick<QuestTemplate, "id" | "fallbackTitleRu" | "fallbackTitleEn">): string {
  return (dict.questsPage.q2.short as Record<string, string | undefined>)[q.id] || questTitle(dict, lang, q);
}

/** What exactly makes a quest done: the journal's rule, or what the person marks for a self-report. */
export function questCriterion(dict: Dictionary, q: Pick<QuestTemplate, "id">): string | undefined {
  return (dict.questsPage.q2.criteria as Record<string, string | undefined>)[q.id];
}

/** Everyday habits among the extra quests (shown apart from the trading challenges; the game rules are the same). */
export const HABIT_QUESTS: ReadonlySet<string> = new Set([
  "q_walk",
  "q_meditate",
  "q_sleep_prep",
  "q_lang_study",
  "q_lang_10m",
  "q_workout",
  "q_stretching",
  "q_read_pages",
  "q_running",
  "q_swimming",
  "q_gym",
]);
