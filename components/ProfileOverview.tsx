"use client";

import React, { useState } from "react";
import { Edit2, ChevronDown } from "lucide-react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { FollowersBlock } from "@/components/FollowersBlock";
import { ReputationBlock } from "@/components/ReputationBlock";
import { StatsBlock } from "@/components/StatsBlock";
import { PlanBadge } from "@/components/PlanBadge";
import { EditProfileModal } from "@/components/EditProfileModal";
import { TitlesModal } from "@/components/TitlesModal";
import { TITLES_CATALOG } from "@/lib/titles";
import { xpForNextLevel } from "@/lib/game";
import { formatString, formatNumber } from "@/lib/i18n";

interface ProfileOverviewProps {
  onGoToStatsTab: () => void;
}

export function ProfileOverview({ onGoToStatsTab }: ProfileOverviewProps) {
  const { gameState } = useGame();
  const { dict, lang } = useApp();

  const [isEditModalOpen, setEditModalOpen] = useState(false);
  const [isTitlesModalOpen, setTitlesModalOpen] = useState(false);

  // Selected title object
  const titleObj = TITLES_CATALOG.find((t) => t.id === gameState.selectedTitle) || TITLES_CATALOG[0];
  const titleNameKey = titleObj.nameKey.split(".")[1];
  const titleName = (dict.titles as any)[titleNameKey] || titleObj.id;

  // Level progress
  const nextXp = xpForNextLevel(gameState.level);
  const xpNeeded = Math.max(0, nextXp - gameState.xp);
  const progressPercent = Math.min(100, Math.round((gameState.xp / nextXp) * 100));

  const completedTodayCount = Object.keys(gameState.completedQuestsToday).length;

  const displayBio = gameState.bio || dict.profile.defaultBio;

  return (
    <div className="space-y-5">
      {/* 1. Compact Header */}
      <div className="card bg-s1 border border-line p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Octagonal badge + Nickname + Pencil + Title */}
          <div className="flex items-center gap-3.5">
            {/* Octagonal Level Badge */}
            <div className="relative flex h-12 w-12 flex-none items-center justify-center font-serif text-lg font-bold text-black bg-gradient-to-br from-[#f3cf7a] to-[#d6a94a] rounded-xl clip-octagon shadow-[0_0_12px_rgba(214,169,74,0.3)]">
              {gameState.level}
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl font-bold text-tx">
                  {gameState.name}
                </h2>
                <button
                  onClick={() => setEditModalOpen(true)}
                  className="rounded-lg p-1 text-mu hover:bg-s2 hover:text-vi-lt transition-colors"
                  aria-label="Edit Profile"
                >
                  <Edit2 size={15} />
                </button>
                <PlanBadge plan={gameState.plan} />
              </div>

              {/* Title dropdown trigger */}
              <button
                onClick={() => setTitlesModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-vi-lt hover:text-tx transition-colors text-left"
              >
                <span>{titleName}</span>
                <ChevronDown size={14} className="flex-none" />
              </button>
            </div>
          </div>

          {/* Right: Bio (Up to 2 lines, truncated with tooltip) */}
          <div className="md:max-w-md w-full text-xs text-mu bg-s2/50 border border-line/60 rounded-xl p-2.5">
            <p className="line-clamp-2 text-tx/90 italic" title={displayBio}>
              «{displayBio}»
            </p>
          </div>
        </div>
      </div>

      {/* 3. Reputation Block */}
      <ReputationBlock />

      {/* 4. Followers Block */}
      <FollowersBlock />

      {/* 4. Full-width Level Bar */}
      <div className="card bg-s1 border border-line p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="font-bold text-vi-lt">
            {dict.topbar.level} {formatNumber(lang, gameState.level)}
          </span>
          <div className="text-right">
            <span className="font-bold text-tx">
              {formatNumber(lang, gameState.xp)} / {formatNumber(lang, nextXp)} XP
            </span>
            <span className="text-mu ml-2 text-[11px]">
              ({formatString(dict.profile.xpToNextLevel, { xp: formatNumber(lang, xpNeeded) })})
            </span>
          </div>
          <span className="font-bold text-mu">
            {dict.topbar.level} {formatNumber(lang, gameState.level + 1)}
          </span>
        </div>

        {/* Bar */}
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-s2 border border-line/50">
          <div
            className="h-full rounded-full bg-gradient-to-r from-vi via-vi-lt to-go transition-all duration-600 ease-out shadow-[0_0_12px_rgba(214,169,74,0.5)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Chips below bar */}
        <div className="flex items-center gap-2 pt-1">
          <span className="chip bg-s2 text-tx border border-line text-xs py-1 px-3">
            {formatString(dict.profile.questsToday, { count: completedTodayCount })}
          </span>
          <span className="chip bg-s2 text-vi-lt border border-vi/30 text-xs py-1 px-3 font-semibold">
            {formatString(dict.profile.streakDays, { count: gameState.currentStreak })}
          </span>
        </div>
      </div>

      {/* 5. Stats Block */}
      <StatsBlock onViewMore={onGoToStatsTab} />

      {/* Modals */}
      <EditProfileModal
        isOpen={isEditModalOpen}
        onClose={() => setEditModalOpen(false)}
      />
      <TitlesModal
        isOpen={isTitlesModalOpen}
        onClose={() => setTitlesModalOpen(false)}
      />
    </div>
  );
}
