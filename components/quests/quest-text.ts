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

/** Title of a history entry: the dictionary when the quest is known, else the title saved at that time. */
export function historyTitle(dict: Dictionary, questId: string, saved: string): string {
  const t = (dict.questTemplates as Record<string, { title: string } | undefined>)[questId];
  return t?.title || saved;
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
