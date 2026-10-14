"use client";

import React from "react";
import { Award, Lock } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { cn } from "@/components/ui/cn";
import { PROFILE_ACHIEVEMENTS, achievementProgress } from "@/lib/profile";
import { formatString } from "@/lib/i18n";

/** Achievement cards: earned ones bright (gold is allowed here), the rest muted with a hint how to earn them. No losses. */
export function AchievementsTab() {
  const { dict } = useApp();
  const { gameState } = useGame();
  const a = dict.profile.achievements as Record<string, string>;
  const a2 = dict.profile.achievementsV2;
  const { done, total } = achievementProgress(gameState);
  const sorted = [...PROFILE_ACHIEVEMENTS].sort((x, y) => Number(!!gameState.achievements[y]) - Number(!!gameState.achievements[x]));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-tx">{formatString(a2.progress, { done, total })}</p>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-s2" aria-hidden="true">
          <div className="h-full rounded-full bg-gradient-to-r from-go/70 to-go" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1700px]:grid-cols-3">
        {sorted.map((id) => {
          const earned = !!gameState.achievements[id];
          return (
            <li
              key={id}
              data-testid="achievement-card"
              data-earned={earned}
              className={cn(
                "flex items-start gap-3 rounded-2xl border p-4",
                earned ? "border-go/50 bg-gradient-to-br from-go/10 to-transparent shadow-[0_0_24px_-14px_rgba(214,169,74,0.9)]" : "border-line bg-s1/50"
              )}
            >
              <span
                aria-hidden="true"
                className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", earned ? "bg-go/20 text-go" : "bg-s2 text-mu")}
              >
                {earned ? <Award size={20} /> : <Lock size={18} />}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", earned ? "text-tx" : "text-mu")}>{a[id]}</p>
                {earned ? (
                  <p className="mt-0.5 text-xs font-semibold text-go">{a2.unlocked}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-mu">
                    <span className="font-semibold">{a2.howTo}:</span> {a[`${id}Desc`]}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
