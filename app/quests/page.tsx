"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString, formatNumber } from "@/lib/i18n";
import { getDeterministicDailyQuests, QUEST_CATEGORY_META, QuestCategory } from "@/lib/quests";
import { GAME_CONFIG } from "@/lib/game-config";
import {
  CheckSquare,
  Shield,
  RotateCcw,
  Plus,
  Trash2,
  Calendar,
  Flame,
  Moon,
  BarChart2,
  Brain,
  Activity,
  Smile,
  Users,
  Sun,
  XCircle,
} from "lucide-react";

export default function QuestsPage() {
  const { dict, lang, showToast } = useApp();
  const {
    gameState,
    completeQuest,
    passQuest,
    replaceQuest,
    toggleRestDay,
    addCustomGoal,
    removeCustomGoal,
  } = useGame();

  const [activeTab, setActiveTab] = useState<"today" | "week" | "goals" | "discipline" | "history">("today");
  const [historyFilter, setHistoryFilter] = useState<string>("All");

  // New goal form state
  const [goalTitle, setGoalTitle] = useState("");
  const [goalCategory, setGoalCategory] = useState<QuestCategory>("Trading");
  const [isAddingGoal, setIsAddingGoal] = useState(false);

  const todayIso = new Date().toISOString().split("T")[0];
  const { core: coreQuests, bonus: bonusQuests } = getDeterministicDailyQuests(todayIso);

  const completedCount = Object.keys(gameState.completedQuestsToday).length;
  const totalDailyAvailable = coreQuests.length + bonusQuests.length;

  const getCategoryIcon = (category: QuestCategory) => {
    switch (category) {
      case "Trading": return BarChart2;
      case "Discipline": return CheckSquare;
      case "Psychology": return Brain;
      case "Physical": return Activity;
      case "Mental": return Smile;
      case "Social": return Users;
      case "Lifestyle": return Sun;
      default: return CheckSquare;
    }
  };

  const handleComplete = (id: string, fallbackTitle: string, category: string, xp: number, coins: number) => {
    if (gameState.completedQuestsToday[id]) return;
    const res = completeQuest(id, fallbackTitle, category, xp, coins);
    if (res.leveledUp) {
      showToast(`Level up! Lv ${res.newLevel}`);
    } else {
      showToast(`+${xp} XP · +${coins} Coins`);
    }
  };

  const handlePass = (id: string) => {
    passQuest(id);
    showToast(dict.questsPage.todayTab.notTodayToast);
  };

  const handleReplace = (id: string) => {
    const success = replaceQuest(id);
    if (success) {
      showToast(dict.questsPage.todayTab.questReplacedToast);
    } else {
      showToast(dict.questsPage.todayTab.replaceLimitReached);
    }
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalTitle.trim()) return;
    addCustomGoal(goalTitle.trim(), goalCategory);
    setGoalTitle("");
    setIsAddingGoal(false);
    showToast(dict.questsPage.goalsTab.goalAddedToast);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl">
          {dict.questsPage.title}
        </h1>
        <p className="text-xs text-mu">{dict.questsPage.subtitle}</p>
      </div>

      {/* Tabs Row */}
      <div className="flex gap-2 border-b border-line pb-2 overflow-x-auto no-scrollbar">
        {(["today", "week", "goals", "discipline", "history"] as const).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-s2 text-tx border border-vi"
                  : "text-mu hover:bg-s2/60 hover:text-tx"
              }`}
            >
              {dict.questsPage.tabs[tab]}
            </button>
          );
        })}
      </div>

      {/* TODAY TAB */}
      {activeTab === "today" && (
        <div className="space-y-6">
          {/* Summary Banner */}
          <div className="card bg-gradient-to-r from-s1 via-[#1c1b28] to-s1 flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="space-y-1">
              <div className="text-sm font-bold text-tx">
                {formatString(dict.questsPage.todayTab.completedSummary, {
                  count: formatNumber(lang, completedCount),
                  total: formatNumber(lang, totalDailyAvailable),
                })}
              </div>
              <div className="text-xs text-mu">
                {formatString(dict.questsPage.todayTab.todayXpCoins, {
                  xp: formatNumber(lang, completedCount * 40),
                  coins: formatNumber(lang, completedCount * 10),
                })}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-xl border border-go/40 bg-go/10 px-3 py-1.5 text-xs font-bold text-go">
                <Flame size={16} />
                <span>
                  {formatString(dict.questsPage.todayTab.streakBadge, {
                    streak: formatNumber(lang, gameState.currentStreak),
                  })}
                </span>
              </div>

              <button
                onClick={toggleRestDay}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  gameState.isRestDay
                    ? "border-vi bg-vi text-white"
                    : "border-line bg-s2 text-mu hover:text-tx"
                }`}
              >
                <Moon size={15} />
                <span>{dict.questsPage.todayTab.restDayToggle}</span>
              </button>
            </div>
          </div>

          {gameState.isRestDay ? (
            <div className="card text-center py-12 space-y-2">
              <Moon size={32} className="mx-auto text-vi animate-pulse" />
              <h3 className="font-serif text-lg font-bold text-tx">
                {dict.questsPage.todayTab.restDayToggle}
              </h3>
              <p className="text-xs text-mu max-w-md mx-auto">
                {dict.questsPage.todayTab.restDayActive}
              </p>
            </div>
          ) : (
            <>
              {/* CORE QUESTS SECTION */}
              <div className="space-y-3">
                <h3 className="h4 text-sm font-bold">{dict.questsPage.todayTab.coreTitle}</h3>
                <div className="grid grid-cols-1 gap-3">
                  {coreQuests.map((q) => {
                    const isDone = !!gameState.completedQuestsToday[q.id];
                    const isPassed = !!gameState.passedQuestsToday[q.id];

                    if (isPassed && !isDone) return null;

                    const title =
                      dict.questTemplates[q.id as keyof typeof dict.questTemplates]?.title ||
                      (lang === "ru" ? q.fallbackTitleRu : q.fallbackTitleEn);

                    const whyReason =
                      dict.questTemplates[q.id as keyof typeof dict.questTemplates]?.why ||
                      (lang === "ru" ? q.fallbackWhyRu : q.fallbackWhyEn);

                    const meta = QUEST_CATEGORY_META[q.category];
                    const Icon = getCategoryIcon(q.category);

                    return (
                      <div
                        key={q.id}
                        className={`card space-y-3 transition-colors ${
                          isDone ? "opacity-60 border-vi/40" : "hover:border-vi"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="p-2 rounded-lg flex-none"
                              style={{ backgroundColor: meta.bg, color: meta.color }}
                            >
                              <Icon size={18} />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-tx">{title}</div>
                              <div className="text-[11px] text-mu mt-0.5 flex items-center gap-2">
                                <span style={{ color: meta.color }}>
                                  {dict.categories[q.category]}
                                </span>
                                <span>· {q.durationMinutes} min</span>
                                <span>· +{q.xpReward} XP / +{q.coinsReward} Coins</span>
                              </div>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2">
                            {isDone ? (
                              <span className="text-xs font-bold text-vi bg-vi/10 px-3 py-1.5 rounded-xl border border-vi/30">
                                {dict.questsPage.todayTab.completedBadge}
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => handlePass(q.id)}
                                  className="btn-ghost text-xs py-1.5 px-2.5 text-mu hover:text-tx"
                                  title={dict.questsPage.todayTab.notTodayBtn}
                                >
                                  <XCircle size={15} />
                                </button>
                                <button
                                  onClick={() => handleReplace(q.id)}
                                  disabled={gameState.replacementsUsedToday >= GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY}
                                  className="btn-ghost text-xs py-1.5 px-2.5 text-mu hover:text-tx disabled:opacity-40"
                                  title={formatString(dict.questsPage.todayTab.replaceBtn, {
                                    used: gameState.replacementsUsedToday,
                                  })}
                                >
                                  <RotateCcw size={15} />
                                </button>
                                <button
                                  onClick={() =>
                                    handleComplete(q.id, title, q.category, q.xpReward, q.coinsReward)
                                  }
                                  className="btn text-xs py-1.5 px-3.5"
                                >
                                  {dict.questsPage.todayTab.completeBtn}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Why note */}
                        <div className="text-[11px] text-mu bg-s2/50 p-2.5 rounded-lg border border-line/60">
                          <span className="font-semibold text-tx">
                            {dict.questsPage.todayTab.whyTitle}{" "}
                          </span>
                          {whyReason}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* BONUS QUESTS SECTION */}
              <div className="space-y-3 pt-2">
                <h3 className="h4 text-sm font-bold">{dict.questsPage.todayTab.bonusTitle}</h3>
                <div className="grid grid-cols-1 gap-3">
                  {bonusQuests.map((q) => {
                    const isDone = !!gameState.completedQuestsToday[q.id];
                    const isPassed = !!gameState.passedQuestsToday[q.id];

                    if (isPassed && !isDone) return null;

                    const title =
                      dict.questTemplates[q.id as keyof typeof dict.questTemplates]?.title ||
                      (lang === "ru" ? q.fallbackTitleRu : q.fallbackTitleEn);

                    const meta = QUEST_CATEGORY_META[q.category];
                    const Icon = getCategoryIcon(q.category);

                    return (
                      <div
                        key={q.id}
                        className={`card flex items-center justify-between gap-3 p-3 transition-colors ${
                          isDone ? "opacity-60 border-vi/40" : "hover:border-vi"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className="p-2 rounded-lg flex-none"
                            style={{ backgroundColor: meta.bg, color: meta.color }}
                          >
                            <Icon size={16} />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-tx">{title}</div>
                            <div className="text-[10px] text-mu mt-0.5">
                              +{q.xpReward} XP · +{q.coinsReward} Coins
                            </div>
                          </div>
                        </div>

                        {isDone ? (
                          <span className="text-xs font-bold text-vi">✓</span>
                        ) : (
                          <button
                            onClick={() =>
                              handleComplete(q.id, title, q.category, q.xpReward, q.coinsReward)
                            }
                            className="btn text-xs py-1.5 px-3"
                          >
                            {dict.questsPage.todayTab.completeBtn}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* WEEK TAB */}
      {activeTab === "week" && (
        <div className="space-y-6">
          {/* Challenge Box */}
          <div className="card space-y-3">
            <h3 className="font-serif text-lg font-bold text-tx">
              {formatString(dict.questsPage.weekTab.challengeTitle, { count: 10 })}
            </h3>
            <p className="text-xs text-mu">{dict.questsPage.weekTab.challengeDesc}</p>
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-mu">{dict.questsPage.weekTab.progressLabel}</span>
                <span className="text-go">
                  {Math.min(10, gameState.weeklyQuestCount)} / 10
                </span>
              </div>
              <div className="xp h-2.5 bg-white/10">
                <i
                  className="block h-full bg-gradient-to-r from-pri to-vi"
                  style={{
                    width: `${Math.min(100, gameState.weeklyQuestCount * 10)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* 7-Day Rhythm */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.questsPage.weekTab.rowTitle}</h4>
            <div className="grid grid-cols-7 gap-2 text-center text-xs">
              {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((dKey, idx) => (
                <div
                  key={dKey}
                  className="rounded-xl border border-line bg-s2/60 p-3 space-y-1"
                >
                  <div className="text-[11px] font-semibold text-mu">
                    {dict.questsPage.weekTab.days[dKey]}
                  </div>
                  <div className="text-lg font-bold text-tx">
                    {idx === 0 ? "✓" : "·"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* GOALS TAB */}
      {activeTab === "goals" && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-serif text-lg font-bold text-tx">
                  {dict.questsPage.goalsTab.emptyTitle}
                </h3>
                <p className="text-xs text-mu mt-0.5">
                  {dict.questsPage.goalsTab.emptyDesc}
                </p>
              </div>

              {!isAddingGoal && (
                <button
                  onClick={() => setIsAddingGoal(true)}
                  disabled={gameState.customGoals.length >= GAME_CONFIG.MAX_CUSTOM_GOALS}
                  className="btn text-xs py-2 px-3 flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Plus size={15} />
                  <span>{dict.questsPage.goalsTab.addGoalBtn}</span>
                </button>
              )}
            </div>

            {/* Goal Form */}
            {isAddingGoal && (
              <form onSubmit={handleSaveGoal} className="card bg-s2/80 space-y-3 mt-4">
                <input
                  type="text"
                  required
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder={dict.questsPage.goalsTab.goalTitlePlaceholder}
                  className="w-full rounded-xl border border-line bg-s1 p-2.5 text-xs text-tx outline-none focus:border-vi"
                />

                <div className="flex items-center gap-3 text-xs">
                  <span className="text-mu">{dict.questsPage.goalsTab.categoryLabel}:</span>
                  <select
                    value={goalCategory}
                    onChange={(e) => setGoalCategory(e.target.value as QuestCategory)}
                    className="rounded-xl border border-line bg-s1 p-2 text-xs text-tx outline-none"
                  >
                    {(
                      [
                        "Trading",
                        "Discipline",
                        "Psychology",
                        "Physical",
                        "Mental",
                        "Social",
                        "Lifestyle",
                      ] as const
                    ).map((cat) => (
                      <option key={cat} value={cat}>
                        {dict.categories[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingGoal(false)}
                    className="btn-ghost text-xs py-1.5 px-3"
                  >
                    {dict.questsPage.goalsTab.cancelBtn}
                  </button>
                  <button type="submit" className="btn text-xs py-1.5 px-3.5">
                    {dict.questsPage.goalsTab.saveBtn}
                  </button>
                </div>
              </form>
            )}

            {/* Goal List */}
            <div className="space-y-2 pt-2">
              {gameState.customGoals.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-s2/40 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-tx">{g.title}</div>
                    <div className="text-[10px] text-mu">
                      {dict.categories[g.category as QuestCategory] || g.category}
                    </div>
                  </div>
                  <button
                    onClick={() => removeCustomGoal(g.id)}
                    className="text-mu hover:text-red-400 p-1"
                    title={dict.questsPage.goalsTab.deleteBtn}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DISCIPLINE TAB */}
      {activeTab === "discipline" && (
        <div className="space-y-6">
          {/* Note Rule */}
          <div className="text-xs text-mu bg-s2/40 p-3 rounded-xl border border-line">
            ℹ {dict.questsPage.disciplineTab.streakRuleNote}
          </div>

          {/* Streak Numbers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="card text-center space-y-1 p-4">
              <Flame size={28} className="mx-auto text-go" />
              <div className="text-2xl font-bold text-tx">
                {gameState.currentStreak} {dict.questsPage.disciplineTab.daysWord}
              </div>
              <div className="text-xs text-mu">
                {dict.questsPage.disciplineTab.currentStreak}
              </div>
            </div>

            <div className="card text-center space-y-1 p-4">
              <Flame size={28} className="mx-auto text-vi" />
              <div className="text-2xl font-bold text-tx">
                {gameState.bestStreak} {dict.questsPage.disciplineTab.daysWord}
              </div>
              <div className="text-xs text-mu">
                {dict.questsPage.disciplineTab.bestStreak}
              </div>
            </div>
          </div>

          {/* Streak Shield Card */}
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={20} className="text-go" />
                <h4 className="h4">{dict.questsPage.disciplineTab.shieldTitle}</h4>
              </div>
              <span className="chip border-go text-go">
                {formatString(dict.questsPage.disciplineTab.shieldAvailable, {
                  count: gameState.streakShieldsAvailable,
                })}
              </span>
            </div>
            <p className="text-xs text-mu">
              {dict.questsPage.disciplineTab.shieldDesc}
            </p>
          </div>

          {/* 4-Week Activity Heatmap */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.questsPage.disciplineTab.heatmapTitle}</h4>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px]">
              {Array.from({ length: 28 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-8 rounded-lg border flex items-center justify-center font-bold ${
                    i >= 20
                      ? "border-vi bg-pri/30 text-vi"
                      : "border-line bg-s2/40 text-mu"
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Category Filter */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => setHistoryFilter("All")}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                historyFilter === "All"
                  ? "bg-vi text-white"
                  : "bg-s2 text-mu hover:text-tx"
              }`}
            >
              {dict.questsPage.historyTab.filterAll}
            </button>
            {(
              [
                "Trading",
                "Discipline",
                "Psychology",
                "Physical",
                "Mental",
                "Social",
                "Lifestyle",
              ] as const
            ).map((cat) => (
              <button
                key={cat}
                onClick={() => setHistoryFilter(cat)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                  historyFilter === cat
                    ? "bg-vi text-white"
                    : "bg-s2 text-mu hover:text-tx"
                }`}
              >
                {dict.categories[cat]}
              </button>
            ))}
          </div>

          {/* History List */}
          <div className="space-y-2">
            {gameState.history.filter(
              (item) => historyFilter === "All" || item.category === historyFilter
            ).length === 0 ? (
              <div className="card text-center py-12 text-xs text-mu">
                {dict.questsPage.historyTab.empty}
              </div>
            ) : (
              gameState.history
                .filter(
                  (item) => historyFilter === "All" || item.category === historyFilter
                )
                .map((item, idx) => (
                  <div
                    key={idx}
                    className="card flex items-center justify-between p-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-tx">{item.questTitle}</div>
                      <div className="text-[10px] text-mu mt-0.5">
                        {formatString(dict.questsPage.historyTab.completedAt, {
                          date: item.completedAt,
                        })}
                      </div>
                    </div>
                    <div className="font-bold text-go">
                      +{item.xp} XP · +{item.coins} Coins
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
