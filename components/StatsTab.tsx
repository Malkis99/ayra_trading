"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import {
  StatKey,
  getStatLevelAndRank,
  getCharacterPower,
  getStatBalance,
} from "@/lib/game";
import { GAME_CONFIG } from "@/lib/game-config";
import { formatString, formatNumber } from "@/lib/i18n";
import {
  Zap,
  LineChart,
  Brain,
  Target,
  Smile,
  BookOpen,
  Activity,
  Dumbbell,
  Shield,
  CheckCircle,
  Award,
  Flame,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const STAT_ICONS: Record<StatKey, React.ReactNode> = {
  discipline: <Zap size={20} className="text-amber-400" />,
  trading: <LineChart size={20} className="text-emerald-400" />,
  intelligence: <Brain size={20} className="text-sky-400" />,
  focus: <Target size={20} className="text-violet-400" />,
  psychology: <Smile size={20} className="text-pink-400" />,
  knowledge: <BookOpen size={20} className="text-indigo-400" />,
  endurance: <Activity size={20} className="text-teal-400" />,
  strength: <Dumbbell size={20} className="text-rose-400" />,
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

const STAT_CATEGORIES: Record<StatKey, string[]> = {
  discipline: ["Discipline", "Trading"],
  trading: ["Trading"],
  intelligence: ["Mental", "Trading"],
  focus: ["Mental", "Psychology"],
  psychology: ["Psychology", "Lifestyle"],
  knowledge: ["Mental", "Social"],
  endurance: ["Physical", "Discipline"],
  strength: ["Physical", "Lifestyle"],
};

export function StatsTab() {
  const { gameState } = useGame();
  const { dict, lang } = useApp();

  const [expandedStat, setExpandedStat] = useState<StatKey | null>(null);

  const power = getCharacterPower(gameState);
  const balance = getStatBalance(gameState);
  const statKeys = GAME_CONFIG.STAT_KEYS;

  const strongestName = (dict.stats.names as any)[balance.strongestStat] || balance.strongestStat;
  const weakestName = (dict.stats.names as any)[balance.weakestStat] || balance.weakestStat;

  const renderMiniTrend = (statKey: StatKey, color: string) => {
    const snapshots = gameState.statSnapshots || [];
    let pointsData: number[] = [];

    if (snapshots.length >= 2) {
      pointsData = snapshots.map((s) => s.stats[statKey] || 0);
    } else {
      const current = gameState.stats[statKey] || 0;
      pointsData = [
        Math.max(0, current - 25),
        Math.max(0, current - 20),
        Math.max(0, current - 15),
        Math.max(0, current - 5),
        current,
      ];
    }

    const min = Math.min(...pointsData, 0);
    const max = Math.max(...pointsData, 100);
    const range = max - min || 1;

    const svgWidth = 80;
    const svgHeight = 24;

    const coords = pointsData.map((val, idx) => {
      const x = (idx / (pointsData.length - 1)) * svgWidth;
      const y = svgHeight - ((val - min) / range) * (svgHeight - 4) - 2;
      return `${x},${y}`;
    });

    const pathD = `M ${coords.join(" L ")}`;

    return (
      <svg
        width={svgWidth}
        height={svgHeight}
        className="overflow-visible"
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Ribbon (4 Metrics) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-3.5 bg-s1 border border-line">
          <span className="text-[11px] text-mu font-medium">
            {dict.stats.power}
          </span>
          <p className="font-serif text-2xl font-bold text-tx tabular-nums mt-0.5">
            {formatNumber(lang, power)}
          </p>
          <span className="text-[10px] text-mu/80 mt-1 block">
            {dict.stats.powerHint}
          </span>
        </div>

        <div className="card p-3.5 bg-s1 border border-line">
          <span className="text-[11px] text-mu font-medium">
            {dict.stats.strongest}
          </span>
          <p className="font-serif text-lg font-bold text-go mt-0.5 truncate">
            {strongestName}
          </p>
          <span className="text-[10px] text-go/80 mt-1 block">
            Lv. {getStatLevelAndRank(gameState.stats[balance.strongestStat] || 0).level}
          </span>
        </div>

        <div className="card p-3.5 bg-s1 border border-line">
          <span className="text-[11px] text-mu font-medium">
            {dict.stats.growthArea}
          </span>
          <p className="font-serif text-lg font-bold text-amber-400 mt-0.5 truncate">
            {weakestName}
          </p>
          <span className="text-[10px] text-amber-400/80 mt-1 block">
            Lv. {getStatLevelAndRank(gameState.stats[balance.weakestStat] || 0).level}
          </span>
        </div>

        <div className="card p-3.5 bg-s1 border border-line">
          <span className="text-[11px] text-mu font-medium">
            {dict.stats.balance}
          </span>
          <p
            className={`font-serif text-lg font-bold mt-0.5 ${
              balance.isBalanced ? "text-emerald-400" : "text-vi-lt"
            }`}
          >
            {balance.isBalanced ? dict.stats.balanced : dict.stats.skewed}
          </p>
          <span className="text-[10px] text-mu/80 mt-1 block truncate">
            {balance.isBalanced
              ? dict.stats.profileIsFlat
              : formatString(dict.stats.developStat, { stat: weakestName })}
          </span>
        </div>
      </div>

      {/* Stat Cards Grid (2 cols md+, 1 col mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {statKeys.map((key) => {
          const xp = gameState.stats[key] || 0;
          const info = getStatLevelAndRank(xp);
          const name = (dict.stats.names as any)[key] || key;
          const rank = (dict.stats.ranks as any)[info.rankKey] || info.rankKey;
          const color = STAT_COLORS[key];
          const categories = STAT_CATEGORIES[key] || [];
          const isExpanded = expandedStat === key;

          return (
            <div
              key={key}
              className="card bg-s1 border border-line p-4 space-y-3 transition-all duration-200 hover:border-vi/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl border bg-s2"
                    style={{ borderColor: `${color}60` }}
                  >
                    {STAT_ICONS[key]}
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm text-tx">{name}</h4>
                    <p className="text-xs text-mu">
                      {rank} · Lv. {info.level}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {renderMiniTrend(key, color)}
                  <button
                    onClick={() => setExpandedStat(isExpanded ? null : key)}
                    className="p-1 text-mu hover:text-tx rounded-lg hover:bg-s2"
                    aria-label="Expand details"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
              </div>

              {/* Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-mu">{dict.stats.progressLabel}</span>
                  <span className="text-tx font-bold">
                    {formatNumber(lang, info.currentLevelXp)} / {formatNumber(lang, info.nextLevelXp || 100)} XP
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-s2 border border-line/40">
                  <div
                    className="h-full rounded-full transition-all duration-600 ease-out"
                    style={{
                      width: `${info.progressPercent}%`,
                      background: `linear-gradient(90deg, ${color}aa, ${color})`,
                      boxShadow: `0 0 10px ${color}80`,
                    }}
                  />
                </div>
              </div>

              {/* Categories & Improve Button */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-line/40 text-xs">
                <div className="flex items-center gap-1 text-mu truncate">
                  <span>{dict.stats.developsCategories}</span>
                  <span className="text-tx font-semibold truncate">
                    {categories.map((c) => (dict.categories as any)[c] || c).join(", ")}
                  </span>
                </div>

                <Link
                  href="/quests"
                  className="btn-ghost text-xs py-1 px-2.5 text-vi-lt hover:text-tx border border-line rounded-lg hover:border-vi flex-none"
                >
                  {dict.stats.howToImprove} →
                </Link>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="pt-2 border-t border-line space-y-2 text-xs animate-fade-in">
                  <div className="flex justify-between text-mu">
                    <span>{dict.stats.weeklyGain}:</span>
                    <span className="text-emerald-400 font-bold">+15 XP</span>
                  </div>
                  <div className="flex justify-between text-mu">
                    <span>{dict.stats.currentRankLabel}:</span>
                    <span className="text-tx font-bold">{rank}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Counters Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
        <div className="card p-3 bg-s1/60 border border-line flex items-center gap-3">
          <CheckCircle size={20} className="text-emerald-400 flex-none" />
          <div>
            <span className="font-serif text-lg font-bold text-tx tabular-nums">
              {formatNumber(lang, gameState.history ? gameState.history.length : 0)}
            </span>
            <p className="text-[11px] text-mu">
              {dict.stats.counters.quests}
            </p>
          </div>
        </div>

        <div className="card p-3 bg-s1/60 border border-line flex items-center gap-3">
          <Shield size={20} className="text-vi-lt flex-none" />
          <div>
            <span className="font-serif text-lg font-bold text-tx tabular-nums">
              {formatNumber(lang, Object.keys(gameState.equipment || {}).length)}
            </span>
            <p className="text-[11px] text-mu">
              {dict.stats.counters.items}
            </p>
          </div>
        </div>

        <div className="card p-3 bg-s1/60 border border-line flex items-center gap-3">
          <Award size={20} className="text-go flex-none" />
          <div>
            <span className="font-serif text-lg font-bold text-tx tabular-nums">
              {formatNumber(lang, Object.keys(gameState.achievements || {}).length)}
            </span>
            <p className="text-[11px] text-mu">
              {dict.stats.counters.achievements}
            </p>
          </div>
        </div>

        <div className="card p-3 bg-s1/60 border border-line flex items-center gap-3">
          <Flame size={20} className="text-amber-400 flex-none" />
          <div>
            <span className="font-serif text-lg font-bold text-tx tabular-nums">
              {formatNumber(lang, gameState.currentStreak || 0)}
            </span>
            <p className="text-[11px] text-mu">
              {dict.stats.counters.streak}
            </p>
          </div>
        </div>
      </div>

      {/* Subtitle Disclaimer */}
      <p className="text-xs text-center text-mu/70 italic pt-2">
        {dict.stats.disclaimer}
      </p>
    </div>
  );
}
