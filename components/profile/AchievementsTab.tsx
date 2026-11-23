"use client";

import React from "react";
import { Award, Lock } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { cn } from "@/components/ui/cn";
import { PROFILE_ACHIEVEMENTS } from "@/lib/profile";
import { formatString } from "@/lib/i18n";
import { WeekTrophies } from "@/components/quests/WeekChallenge";
import { CategoryAchievements } from "@/components/quests/PersonalCompletion";

type CardStatus = "earned" | "legacy_accepted" | "pending_review" | "rejected" | null;

/**
 * Achievement cards: earned ones bright (gold is allowed here), the rest muted with a hint how to earn them. No losses.
 * Q4.6: once the server recorded the account's achievements (cloud_active), the server's states are shown — a proven
 * one as earned, one moved from the device as such, one waiting for review as moved and waiting, one not confirmed as
 * locked with that note; the device's own flags stay in its storage as an archive.
 */
export function AchievementsTab() {
  const { dict } = useApp();
  const { gameState, economy } = useGame();
  const a = dict.profile.achievements as Record<string, string>;
  const a2 = dict.profile.achievementsV2;
  const server = economy.mode === "cloud_active" && economy.achievements?.transferred ? economy.achievements.items : null;
  const statusOf = (id: string): CardStatus => {
    if (!server) return gameState.achievements[id] ? "earned" : null;
    const s = server.find((x) => x.id === id)?.status;
    return s === "verified" ? "earned" : s ?? null;
  };
  const isEarned = (s: CardStatus) => s === "earned" || s === "legacy_accepted" || s === "pending_review";
  const total = PROFILE_ACHIEVEMENTS.length;
  const done = PROFILE_ACHIEVEMENTS.filter((id) => isEarned(statusOf(id))).length;
  const sorted = [...PROFILE_ACHIEVEMENTS].sort((x, y) => Number(isEarned(statusOf(y))) - Number(isEarned(statusOf(x))));
  const note = (s: CardStatus) => (s === "legacy_accepted" ? a2.legacyAccepted : s === "pending_review" ? a2.pendingReview : a2.unlocked);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-tx">{formatString(a2.progress, { done, total })}</p>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-s2" aria-hidden="true">
          <div className="h-full rounded-full bg-gradient-to-r from-go/70 to-go" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      </div>
      {server && (
        <p className="text-xs text-mu" data-testid="achievements-server-source">
          {a2.serverSource}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1700px]:grid-cols-3">
        {sorted.map((id) => {
          const status = statusOf(id);
          const earned = isEarned(status);
          return (
            <li
              key={id}
              data-testid="achievement-card"
              data-earned={earned}
              data-id={id}
              data-status={server ? status ?? "none" : undefined}
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
                  <p className="mt-0.5 text-xs font-semibold text-go">{note(status)}</p>
                ) : status === "rejected" ? (
                  <p className="mt-0.5 text-xs text-mu">{a2.rejected}</p>
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
      <CategoryAchievements />
      <WeekTrophies />
    </div>
  );
}
