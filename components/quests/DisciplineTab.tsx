"use client";

import React from "react";
import { Flame, Info, Shield } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import type { DayCell } from "@/lib/quests-view";
import { ActivityHeatmap } from "./ActivityHeatmap";

/** Streaks, the shield and real activity. The discipline index comes later (Q3), with enough data. */
export function DisciplineTab({ grid }: { grid: DayCell[][] }) {
  const { dict } = useApp();
  const { gameState } = useGame();
  const t = dict.questsPage.disciplineTab;
  const q = dict.questsPage.q1.discipline;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 rounded-lg border border-line bg-s1 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-tx">{q.activityTitle}</h2>
        <p className="mb-4 mt-1 text-sm text-mu">{q.activityNote}</p>
        <ActivityHeatmap grid={grid} />
      </section>

      <aside className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-s1 p-4 text-center">
            <Flame size={24} aria-hidden="true" className="mx-auto text-vi" />
            <div className="mt-1 font-serif text-2xl font-bold text-tx" data-testid="streak-current">
              {gameState.currentStreak} <span className="text-base">{t.daysWord}</span>
            </div>
            <div className="text-xs text-mu">{t.currentStreak}</div>
          </div>
          <div className="rounded-lg border border-line bg-s1 p-4 text-center">
            <Flame size={24} aria-hidden="true" className="mx-auto text-mu" />
            <div className="mt-1 font-serif text-2xl font-bold text-tx" data-testid="streak-best">
              {gameState.bestStreak} <span className="text-base">{t.daysWord}</span>
            </div>
            <div className="text-xs text-mu">{t.bestStreak}</div>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-s1 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield size={18} aria-hidden="true" className="text-vi" />
              <h2 className="text-[15px] font-semibold text-tx">{t.shieldTitle}</h2>
            </div>
            <span className="text-sm font-semibold text-tx" data-testid="shield-count">
              {formatString(q.shieldCount, { count: gameState.streakShieldsAvailable, max: GAME_CONFIG.STREAK_SHIELDS_PER_WEEK })}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-mu">{t.shieldDesc}</p>
        </div>
        <p className="flex gap-2 rounded-lg bg-s2/60 p-3 text-xs text-mu">
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          {q.streakRule}
        </p>
      </aside>
    </div>
  );
}
