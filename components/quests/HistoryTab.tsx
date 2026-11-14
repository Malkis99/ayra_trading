"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { historySource } from "@/lib/quests-view";
import type { QuestCategory } from "@/lib/quests";
import { cn } from "@/components/ui/cn";
import { VerificationBadge } from "./VerificationBadge";
import { historyTitle } from "./quest-text";
import { formatDayKey } from "./WeekTab";

const CATEGORIES: QuestCategory[] = ["Trading", "Discipline", "Psychology", "Physical", "Mental", "Social", "Lifestyle"];

/**
 * Completed quests, newest first: when (with the time for new entries), how confirmed, what they gave. Under the map and
 * the day panel it is folded by default (QH-5): the day panel answers «what happened that day», this is the full list.
 */
export function HistoryTab() {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const [filter, setFilter] = useState<"All" | QuestCategory>("All");
  const [open, setOpen] = useState(false);
  const v = dict.questsPage.q2.historyView;
  const h = dict.questsPage.q1.history;
  const card = dict.questsPage.q1.card;
  const tz = gameState.profile?.timezone;

  const matches = (category: string) => filter === "All" || category.toLowerCase() === filter.toLowerCase();
  const items = gameState.history.map((item, index) => ({ item, index })).filter(({ item }) => matches(item.category || ""));

  const when = (completedAt: string, at?: string) => {
    const date = formatDayKey(completedAt.slice(0, 10), lang, { day: "numeric", month: "long" });
    if (!at) return date;
    let time = "";
    try {
      time = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined }).format(new Date(at));
    } catch {
      return date;
    }
    return formatString(h.at, { date, time });
  };

  const chip = (id: "All" | QuestCategory, label: string) => (
    <button
      key={id}
      type="button"
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
      className={cn(
        "min-h-[40px] whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
        filter === id ? "bg-vi/15 text-tx ring-1 ring-inset ring-vi" : "bg-s2 text-mu hover:text-tx"
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-s1/50 p-4" aria-labelledby="history-list-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="history-list-title" className="text-[15px] font-semibold text-tx">{v.listTitle}</h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="history-list-body"
          onClick={() => setOpen((x) => !x)}
          data-testid="history-toggle"
          className="min-h-[44px] rounded-md px-3 text-sm font-semibold text-vi hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        >
          {open ? v.listHide : formatString(v.listShow, { n: gameState.history.length })}
        </button>
      </div>
      {open && (
        <div id="history-list-body" className="space-y-4">
          <div role="group" aria-label={h.filterLabel} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chip("All", dict.questsPage.historyTab.filterAll)}
            {CATEGORIES.map((c) => chip(c, dict.categories[c]))}
          </div>
    
          {items.length === 0 ? (
            <p className="rounded-lg border border-line bg-s1 px-4 py-10 text-center text-sm text-mu">{dict.questsPage.historyTab.empty}</p>
          ) : (
            <ol className="space-y-2" data-testid="history-list">
              {items.map(({ item, index }) => {
                const source = historySource(item.questId);
                return (
                  <li key={`${item.questId}-${item.completedAt}-${item.at ?? index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-s1 p-3.5" data-testid="history-item">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold text-tx">{historyTitle(dict, item.questId, item.questTitle)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mu">
                        <span>{when(item.completedAt, item.at)}</span>
                        <VerificationBadge source={source} label={source === "journal" ? card.badgeJournal : card.badgeSelf} />
                      </div>
                    </div>
                    <div className="text-sm font-bold text-tx" data-testid="history-reward">
                      {item.coins > 0
                        ? formatString(dict.questsPage.todayTab.rewardXpCoins, { xp: item.xp, coins: item.coins })
                        : formatString(dict.questsPage.todayTab.rewardXp, { xp: item.xp })}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
