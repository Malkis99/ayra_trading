"use client";

import React from "react";
import { Flame, Shield } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import type { DayCell } from "@/lib/quests-view";
import { ActivityHeatmap } from "./ActivityHeatmap";

/**
 * Discipline at the top of History (the former «Discipline» tab, docs/quest-hub-plan.md 1): the streak, the best
 * streak, the shield and real activity. The discipline index comes later (Q3), with enough data.
 */
export function DisciplineSummary({ grid }: { grid: DayCell[][] }) {
  const { dict } = useApp();
  const { gameState } = useGame();
  const t = dict.questsPage.disciplineTab;
  const q = dict.questsPage.q1.discipline;

  return (
    <div className="space-y-3" data-testid="discipline">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-2xl border border-line bg-s1 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2 font-serif text-2xl font-bold text-tx" data-testid="streak-current">
            <Flame size={18} aria-hidden="true" className="shrink-0 text-vi" />
            {gameState.currentStreak} <span className="hidden text-sm sm:inline">{t.daysWord}</span>
          </div>
          <div className="text-xs text-mu">{t.currentStreak}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-line bg-s1 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2 font-serif text-2xl font-bold text-tx" data-testid="streak-best">
            <Flame size={18} aria-hidden="true" className="shrink-0 text-mu" />
            {gameState.bestStreak} <span className="hidden text-sm sm:inline">{t.daysWord}</span>
          </div>
          <div className="text-xs text-mu">{t.bestStreak}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-line bg-s1 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2 font-serif text-2xl font-bold text-tx" aria-hidden="true">
            <Shield size={18} className="shrink-0 text-vi" />
            {gameState.streakShieldsAvailable}
            <span className="text-sm text-mu">/ {GAME_CONFIG.STREAK_SHIELDS_PER_WEEK}</span>
          </div>
          <div className="text-xs text-mu" data-testid="shield-count">
            <span className="sr-only">{formatString(q.shieldCount, { count: gameState.streakShieldsAvailable, max: GAME_CONFIG.STREAK_SHIELDS_PER_WEEK })}</span>
            <span aria-hidden="true">{t.shieldTitle}</span>
          </div>
        </div>
      </div>

      <section className="min-w-0 rounded-2xl border border-line bg-s1 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-tx">{q.activityTitle}</h2>
        <p className="mb-4 mt-1 text-sm text-mu">{q.activityNote}</p>
        <ActivityHeatmap grid={grid} />
      </section>
    </div>
  );
}

/** How the streak counts — a short rule in the History rail, with the shield's description. */
export function StreakRuleCard() {
  const { dict } = useApp();
  const t = dict.questsPage.disciplineTab;
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="streak-rule">
      <h3 className="text-sm font-bold text-tx">{dict.questsPage.q2.hub.streakTitle}</h3>
      <p className="mt-1.5 text-sm text-mu">{dict.questsPage.q1.discipline.streakRule}</p>
      <p className="mt-2 text-sm text-mu">{t.shieldDesc}</p>
    </section>
  );
}
