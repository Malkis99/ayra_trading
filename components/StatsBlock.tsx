"use client";

import React from "react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import {
  StatKey,
  getStatLevelAndRank,
  getStatBalance,
} from "@/lib/game";
import { GAME_CONFIG } from "@/lib/game-config";
import { formatNumber } from "@/lib/i18n";
import {
  Zap,
  LineChart,
  Brain,
  Target,
  Smile,
  BookOpen,
  Activity,
  Dumbbell,
  ArrowRight,
  Star,
} from "lucide-react";

const STAT_ICONS: Record<StatKey, React.ReactNode> = {
  discipline: <Zap size={18} className="text-amber-400" />,
  trading: <LineChart size={18} className="text-emerald-400" />,
  intelligence: <Brain size={18} className="text-sky-400" />,
  focus: <Target size={18} className="text-violet-400" />,
  psychology: <Smile size={18} className="text-pink-400" />,
  knowledge: <BookOpen size={18} className="text-indigo-400" />,
  endurance: <Activity size={18} className="text-teal-400" />,
  strength: <Dumbbell size={18} className="text-rose-400" />,
};

const STAT_COLORS: Record<StatKey, string> = {
  discipline: "#f59e0b",
  trading: "#10b981",
  intelligence: "#38bdf8",
  focus: "#a38ad1",
  psychology: "#ec4899",
  knowledge: "#6366f1",
  endurance: "#14b8a6",
  strength: "#f43f5e",
};

interface StatsBlockProps {
  onViewMore: () => void;
}

export function StatsBlock({ onViewMore }: StatsBlockProps) {
  const { gameState } = useGame();
  const { dict, lang } = useApp();

  const balanceInfo = getStatBalance(gameState);
  const statKeys = GAME_CONFIG.STAT_KEYS;

  return (
    <div className="card p-4 border border-line space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-tx">
          {dict.stats.title}
        </h3>
        <button
          onClick={onViewMore}
          className="btn-ghost text-xs flex items-center gap-1.5 py-1 px-2.5 text-vi-lt hover:text-tx"
        >
          <span>{dict.stats.viewMore}</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* 8 Stat Rows (2 cols on md+, 1 col on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {statKeys.map((key) => {
          const xp = gameState.stats[key] || 0;
          const info = getStatLevelAndRank(xp);
          const name = (dict.stats.names as any)[key] || key;
          const rank = (dict.stats.ranks as any)[info.rankKey] || info.rankKey;
          const color = STAT_COLORS[key];
          const isStrongest = key === balanceInfo.strongestStat;
          const isWeakest = key === balanceInfo.weakestStat;

          return (
            <div
              key={key}
              className="group relative overflow-hidden rounded-xl border border-line bg-s2/60 p-3 transition-all duration-300 hover:border-vi/50 hover:bg-s2"
            >
              {/* Hover Sheen Effect */}
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-600 ease-in-out group-hover:translate-x-full motion-reduce:hidden" />

              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-s1"
                    style={{ borderColor: `${color}40` }}
                  >
                    {STAT_ICONS[key]}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-tx">{name}</span>
                      {isStrongest && (
                        <span className="flex h-2 w-2 rounded-full bg-go shadow-[0_0_6px_#d6a94a]" title="Strongest stat" />
                      )}
                    </div>
                    <p className="text-[10px] text-mu font-medium">
                      {rank} · Lv. {info.level}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono text-xs font-bold text-tx">
                    {formatNumber(lang, info.currentLevelXp)} / {formatNumber(lang, info.nextLevelXp || 100)} XP
                  </span>
                  <p className="text-[10px] text-emerald-400 font-semibold">
                    +{formatNumber(lang, 15)}
                  </p>
                </div>
              </div>

              {/* Progress Bar (>=12px high, gradient, soft glow) */}
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-s1 border border-line/40">
                <div
                  className="h-full rounded-full transition-all duration-600 ease-out motion-reduce:transition-none"
                  style={{
                    width: `${info.progressPercent}%`,
                    background: `linear-gradient(90deg, ${color}aa, ${color})`,
                    boxShadow: `0 0 10px ${color}80`,
                  }}
                />
              </div>

              {isWeakest && !balanceInfo.isBalanced && (
                <p className="text-[10px] text-amber-400/90 mt-1 font-medium italic">
                  {dict.stats.growthArea}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
