"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { Sparkline } from "@/components/Sparkline";
import { ITEMS, SLOT_KEY_MAP, SlotName } from "@/lib/items";
import {
  calculateStats,
  getCharacterPower,
  getStatBalance,
  getProfileObservations,
  calculateJournalStats,
  exportProfileDataJSON,
  StatKey,
} from "@/lib/stats";
import { ChronicleEntry } from "@/lib/game";
import { GAME_CONFIG } from "@/lib/game-config";
import { formatString } from "@/lib/i18n";
import { Shield, TrendingUp, Brain, Target, Smile, BookOpen, Activity, Zap, Download } from "lucide-react";

/**
 * Full account statistics, restored as it was before PR #50 (period, summary, activity heatmap, progress,
 * quests, 8 characteristics, journal, collection, economy, community, records, observations, milestones, export).
 */
export function StatsTab() {
  const { dict, showToast, openAddModal } = useApp();
  const { gameState } = useGame();
  const { trades: journalTrades } = useJournal();

  // Stats tab period switch: "7d" | "30d" | "90d" | "all"
  const [statsPeriod, setStatsPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [activityMetric, setActivityMetric] = useState<"quests" | "xp">("quests");

  const statsMap = calculateStats(gameState);
  const characterPower = getCharacterPower(statsMap);
  const statBalance = getStatBalance(statsMap);

  const handleExportJSON = () => {
    const jsonStr = exportProfileDataJSON(gameState);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const todayStr = new Date().toISOString().split("T")[0];
    const a = document.createElement("a");
    a.href = url;
    a.download = `ayra-profile-${gameState.name || "TraderOne"}-${todayStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(dict.profile.statsTab.downloadedToast);
  };


  const renderChronicleItem = (entry: ChronicleEntry, idx: number) => {
    let text = "";
    if (typeof entry === "string") {
      text = entry;
    } else {
      switch (entry.type) {
        case "characterCreated":
          text = dict.chronicleEvents.characterCreated;
          break;
        case "questDone":
          text = formatString(dict.chronicleEvents.questDone, {
            title: entry.title,
            xp: entry.xp,
          });
          break;
        case "levelUp":
          text = formatString(dict.chronicleEvents.levelUp, { level: entry.level });
          break;
        case "dailyReward":
          text = formatString(dict.chronicleEvents.dailyReward, { coins: entry.coins });
          break;
        case "firstAction":
          text = formatString(dict.chronicleEvents.firstAction, {
            what: dict.chronicleEvents.firstActionKinds[entry.kind] ?? entry.kind,
            coins: entry.coins,
            xp: entry.xp,
          });
          break;
        case "planChanged":
          text = formatString(dict.chronicleEvents.planChanged, { plan: entry.plan });
          break;
        case "itemEquipped": {
          const itemObj = entry.itemId != null ? ITEMS[entry.itemId] : null;
          const nameKeyShort = itemObj ? itemObj.nameKey.replace("items.", "") : "";
          const name =
            itemObj && (dict.items as any)[nameKeyShort]
              ? (dict.items as any)[nameKeyShort]
              : entry.name || "";
          text = formatString(dict.chronicleEvents.itemEquipped, { name });
          break;
        }
        case "itemUnequipped": {
          const slotKey = SLOT_KEY_MAP[entry.slot as SlotName] || "top";
          const slotName = (dict.slots as any)[slotKey] || entry.slot;
          text = formatString(dict.chronicleEvents.itemUnequipped, { name: slotName });
          break;
        }
        case "titleSelected":
          text = `${dict.chronicleEvents.profileUpdated}: ${entry.titleId}`;
          break;
        case "titleUnlocked":
          text = `${dict.chronicleEvents.profileUpdated}: ${entry.titleId}`;
          break;
        case "achievementUnlocked": {
          const achKey = entry.achievementId || "";
          const achTitle =
            achKey && (dict.profile.achievements as any)[achKey]
              ? (dict.profile.achievements as any)[achKey]
              : entry.title || "";
          text = formatString(dict.chronicleEvents.achievementUnlocked, {
            title: achTitle,
          });
          break;
        }
        case "postPublished":
          text = dict.chronicleEvents.postPublished;
          break;
        case "profileUpdated":
          text = dict.chronicleEvents.profileUpdated;
          break;
        case "legacy":
          text = formatString(dict.chronicleEvents.legacy, { text: entry.text });
          break;
        default:
          text = JSON.stringify(entry);
      }
    }

    return (
      <div key={idx} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-line/60 bg-s2/40 text-xs text-tx">
        <span className="w-2 h-2 rounded-full bg-vi flex-none" />
        <span className="truncate">{text}</span>
      </div>
    );
  };


  const statIcons: Record<StatKey, React.ComponentType<{ size?: number | string; className?: string }>> = {
    discipline: Shield,
    trading: TrendingUp,
    intelligence: Brain,
    focus: Target,
    psychology: Smile,
    knowledge: BookOpen,
    endurance: Activity,
    strength: Zap,
  };

  // Heatmap generation for 26 weeks
  const today = new Date();
  const heatmapDays = Array.from({ length: 26 * 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (26 * 7 - 1 - i));
    const dateStr = d.toISOString().split("T")[0];
    const isBeforeCreated = dateStr < gameState.createdAt;
    const record = gameState.dailyStats?.[dateStr];
    const count = record ? record.totalQuestsCompleted : 0;
    return { dateStr, isBeforeCreated, count, record };
  });


  return (
      <div className="space-y-6">
        {/* Period Selector Header */}
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <h3 className="font-serif text-lg font-bold text-tx">
            {dict.profile.activityProfile}
          </h3>
          <div className="flex gap-1 bg-s2/60 p-1 rounded-xl border border-line text-xs">
            {(["7d", "30d", "90d", "all"] as const).map((p) => {
              const keyMap: Record<string, "d7" | "d30" | "d90" | "all"> = {
                "7d": "d7",
                "30d": "d30",
                "90d": "d90",
                all: "all",
              };
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setStatsPeriod(p)}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    statsPeriod === p ? "bg-pri text-white font-bold" : "text-mu hover:text-tx"
                  }`}
                >
                  {dict.profile.statsTab.periodSelector[keyMap[p]]}
                </button>
              );
            })}
          </div>
        </div>

        {/* BLOCK 1: Summary (Сводка) */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3">
          <b className="text-xs font-bold text-tx block">{dict.profile.statsTab.summary.title}</b>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.characterPower}</span>
              <b className="text-base font-bold text-vi font-mono">{characterPower}</b>
            </div>
            <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.levelXp}</span>
              <b className="text-sm font-bold text-tx font-mono">{dict.topbar.level} {gameState.level} · {gameState.xp} XP</b>
            </div>
            <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.daysWithAyra}</span>
              <b className="text-sm font-bold text-tx font-mono">
                {Math.max(1, Math.ceil((Date.now() - new Date(gameState.createdAt).getTime()) / (1000 * 60 * 60 * 24)))}
              </b>
              <span className="text-[9px] text-mu italic block">{dict.profile.statsTab.calculatedFromUpdate}</span>
            </div>
            <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.activeDays}</span>
              <b className="text-sm font-bold text-tx font-mono">
                {Object.values(gameState.dailyStats || {}).filter((d) => d.totalQuestsCompleted > 0 || d.isRestDay).length}
              </b>
            </div>
            <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.streak}</span>
              <b className="text-sm font-bold text-tx font-mono">{gameState.currentStreak} / {gameState.bestStreak}</b>
            </div>
            <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.questsCompleted}</span>
              <b className="text-sm font-bold text-tx font-mono">{gameState.history.length}</b>
            </div>
          </div>
        </div>

        {/* BLOCK 2: Activity Heatmap (26 weeks / 12 mobile) */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3">
          <div className="flex justify-between items-center">
            <b className="text-xs font-bold text-tx">{dict.profile.statsTab.activity.title}</b>
            <div className="flex gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => setActivityMetric("quests")}
                className={`px-2 py-0.5 rounded border cursor-pointer ${activityMetric === "quests" ? "border-vi bg-pri/30 text-tx" : "border-line text-mu"}`}
              >
                {dict.profile.statsTab.activity.toggleQuests}
              </button>
              <button
                type="button"
                onClick={() => setActivityMetric("xp")}
                className={`px-2 py-0.5 rounded border cursor-pointer ${activityMetric === "xp" ? "border-vi bg-pri/30 text-tx" : "border-line text-mu"}`}
              >
                {dict.profile.statsTab.activity.toggleXp}
              </button>
            </div>
          </div>

          {/* Heatmap Grid */}
          <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto py-1">
            {heatmapDays.map((day, i) => {
              let cellBg = "bg-s2/20 border-line/30";
              let tooltip = `${day.dateStr}: ${dict.profile.statsTab.noDataYet}`;

              if (!day.isBeforeCreated) {
                if (day.count === 0) {
                  cellBg = "bg-s2/60 border-line";
                  tooltip = `${day.dateStr}: ${dict.profile.statsTab.noActivity}`;
                } else if (day.count === 1) {
                  cellBg = "bg-vi/40 border-vi/50";
                  tooltip = `${day.dateStr}: 1`;
                } else if (day.count === 2) {
                  cellBg = "bg-vi/70 border-vi";
                  tooltip = `${day.dateStr}: 2`;
                } else {
                  cellBg = "bg-go border-go text-black";
                  tooltip = `${day.dateStr}: ${day.count}`;
                }
              }

              return (
                <div
                  key={i}
                  title={tooltip}
                  className={`w-3 h-3 rounded-[3px] border ${cellBg} transition-colors`}
                />
              );
            })}
          </div>
        </div>

        {/* BLOCK 3: Progress Chart */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3">
          <b className="text-xs font-bold text-tx block">{dict.profile.statsTab.progress.title}</b>
          <div className="h-20 flex items-center justify-center bg-s1 rounded-xl p-2 border border-line/50">
            <Sparkline points={[10, 20, 15, 30, 45, 60, 50, 75, 80]} isUp={true} />
          </div>
          <div className="text-[11px] text-mu flex justify-between">
            <span>{dict.profile.statsTab.progress.levelsReached}</span>
            <span className="font-mono text-tx">{dict.topbar.level} 1 ({gameState.createdAt}) → {dict.topbar.level} {gameState.level}</span>
          </div>
        </div>

        {/* BLOCK 4: Quests Breakdown */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3 text-xs">
          <b className="font-bold text-tx block">{dict.profile.statsTab.quests.title}</b>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.slots.all}</span>
              <b className="text-sm font-mono text-tx">{gameState.history.length}</b>
            </div>
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.quests.completionRate}</span>
              <b className="text-sm font-mono text-vi">100%</b>
            </div>
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.quests.weeklyAverage}</span>
              <b className="text-sm font-mono text-tx">{Math.round(gameState.history.length / 2)} {dict.profile.perWeek}</b>
            </div>
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.questsPage.todayTab.restDayToggle}</span>
              <b className="text-sm font-mono text-tx">{gameState.isRestDay ? 1 : 0}</b>
            </div>
          </div>
        </div>

        {/* BLOCK 5: 8 Characteristic Cards with "What develops" */}
        <div className="space-y-3">
          <b className="text-xs font-bold text-tx block">{dict.profile.statsTab.characteristics.title}</b>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {(Object.keys(statsMap) as StatKey[]).map((key) => {
              const s = statsMap[key];
              const IconComp = statIcons[key];
              const name = dict.stats[s.key] || s.key;
              const developsCats = GAME_CONFIG.STAT_DEVELOPED_BY_CATEGORIES[key] || [];

              return (
                <div key={key} className="p-3 rounded-xl border border-line bg-s1 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <IconComp size={16} className="text-vi" />
                      <b className="text-tx">{name}</b>
                    </div>
                    <span className="text-mu text-[11px]">{dict.topbar.level} {s.level}</span>
                  </div>

                  <div className="text-[10px] text-mu">
                    <span className="font-semibold">{dict.profile.statsTab.characteristics.develops}</span>{" "}
                    {developsCats.map((catKey) => (dict.categories as any)[catKey] || catKey).join(", ")}
                  </div>

                  <div className="flex justify-between text-[11px] text-mu pt-1">
                    <span>+{s.weeklyGain} {dict.profile.perWeek}</span>
                    <a href="/quests" className="text-vi font-semibold hover:underline">
                      {dict.profile.statsTab.characteristics.howToLevel}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* BLOCK 6: JournalStats Contract */}
        {(() => {
          const jStats = calculateJournalStats(journalTrades, 30);

          return (
            <div className="p-4 rounded-xl border border-line/60 bg-s2/40 space-y-3 text-xs">
              <b className="font-bold text-tx block">{dict.profile.statsTab.journal.title}</b>
              {journalTrades.length === 0 ? (
                <div className="p-4 rounded-xl border border-line bg-s1 text-center space-y-3">
                  <div className="text-mu">{dict.profile.statsTab.journal.willAppear}</div>
                  <button
                    type="button"
                    onClick={() => openAddModal("trade")}
                    className="btn text-xs py-2 px-4 cursor-pointer"
                  >
                    {dict.profile.statsTab.journal.recordTradeBtn}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-2.5 rounded-lg border border-line bg-s1">
                    <span className="text-[10px] text-mu block">{dict.journal.dashboard.kpi.trades}</span>
                    <b className="text-sm font-mono text-tx">{jStats.totalTrades}</b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line bg-s1">
                    <span className="text-[10px] text-mu block">
                      {dict.journal.dashboard.filters.period30d} (R)
                    </span>
                    <b className={`text-sm font-mono ${jStats.periodRResult > 0 ? "text-emerald-400" : jStats.periodRResult < 0 ? "text-rose-400" : "text-tx"}`}>
                      {jStats.periodRResult > 0 ? `+${jStats.periodRResult}` : jStats.periodRResult} R
                    </b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line bg-s1">
                    <span className="text-[10px] text-mu block">
                      {dict.awakening.skills3m.plan_compliance}
                    </span>
                    <b className="text-sm font-mono text-vi">{jStats.planCompliancePercent}%</b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line bg-s1">
                    <span className="text-[10px] text-mu block">{dict.journal.processScoreLabel}</span>
                    <b className="text-sm font-mono text-go">
                      {jStats.averageProcessScore > 0 ? `${jStats.averageProcessScore}/100` : "—"}
                    </b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line bg-s1">
                    <span className="text-[10px] text-mu block">{dict.journal.journalStreak}</span>
                    <b className="text-sm font-mono text-tx">
                      {jStats.journalStreakDays} {dict.journal.daysShort}
                    </b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line bg-s1">
                    <span className="text-[10px] text-mu block">{dict.journal.tabs.notes}</span>
                    <b className="text-sm font-mono text-tx">{jStats.notesCount}</b>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* BLOCK 7: Collection */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
          <b className="font-bold text-tx block">{dict.profile.statsTab.collection.title}</b>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.itemsOpened}</span>
              <b className="text-sm font-mono text-tx">{ITEMS.length}</b>
            </div>
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.equipped}</span>
              <b className="text-sm font-mono text-vi">{Object.keys(gameState.equipment).length}</b>
            </div>
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.titlesOpened}</span>
              <b className="text-sm font-mono text-tx">{gameState.unlockedTitles.length}</b>
            </div>
            <div className="p-2 rounded bg-s1 border border-line/40">
              <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.achievements}</span>
              <b className="text-sm font-mono text-go">{Object.keys(gameState.achievements).length}/5</b>
            </div>
          </div>
        </div>

        {/* BLOCK 8: Economy */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
          <b className="font-bold text-tx block">{dict.profile.statsTab.economy.title}</b>
          <div className="flex justify-between items-center p-2 rounded bg-s1 border border-line/40">
            <span>{dict.profile.statsTab.economy.coinsEarned}</span>
            <b className="text-go font-mono">{gameState.coins} Coins</b>
          </div>
        </div>

        {/* BLOCK 9: Community */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
          <b className="font-bold text-tx block">{dict.profile.statsTab.community.title}</b>
          <div className="flex justify-between text-mu">
            <span>{dict.profile.statsTab.community.posts}: {gameState.posts.length}</span>
            <span>{dict.profile.statsTab.community.comingSoon}</span>
          </div>
        </div>

        {/* BLOCK 10: Records */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
          <b className="font-bold text-tx block">{dict.profile.statsTab.records.title}</b>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded bg-s1">
              <span className="text-mu block">{dict.profile.statsTab.records.bestStreak}</span>
              <b className="text-tx font-mono">{gameState.bestStreak}</b>
            </div>
            <div className="p-2 rounded bg-s1">
              <span className="text-mu block">{dict.profile.statsTab.records.strongestStat}</span>
              <b className="text-vi font-mono capitalize">{dict.stats[statBalance.strongestStat] || statBalance.strongestStat}</b>
            </div>
          </div>
        </div>

        {/* BLOCK 11: Rules-based Observations */}
        {(() => {
          const obs = getProfileObservations(gameState, statsMap);
          const items: string[] = [];

          if (obs.topCategory) {
            const catTranslated = (dict.categories as any)[obs.topCategory] || obs.topCategory;
            items.push(formatString(dict.profile.statsTab.observations.topCategory, { category: catTranslated }));
          } else {
            items.push(formatString(dict.profile.statsTab.observations.topCategory, { category: (dict.categories as any)["trading"] || "Trading" }));
          }

          const weakStatTranslated = dict.stats[obs.growthZone] || obs.growthZone;
          items.push(formatString(dict.profile.statsTab.observations.growthZone, { stat: weakStatTranslated }));

          if (obs.streakInsight === "strongStreak") {
            items.push(formatString(dict.profile.statsTab.observations.streakStrong, { streak: gameState.currentStreak }));
          } else {
            items.push(dict.profile.statsTab.observations.streakBuilding);
          }

          if (obs.adviceTextKey === "balancedProfile") {
            items.push(dict.profile.statsTab.observations.balanced);
          } else {
            items.push(dict.profile.statsTab.observations.focusGrowth);
          }

          return (
            <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
              <b className="font-bold text-tx block">{dict.profile.statsTab.observations.title}</b>
              <ul className="space-y-1.5 pl-4 list-disc text-mu leading-relaxed">
                {items.map((it, idx) => (
                  <li key={idx}>{it}</li>
                ))}
              </ul>
            </div>
          );
        })()}

        {/* BLOCK 12: Recent Milestones */}
        <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
          <b className="font-bold text-tx block">{dict.profile.statsTab.milestones.title}</b>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {gameState.chronicle.slice(0, 10).map(renderChronicleItem)}
          </div>
        </div>

        {/* Export JSON Button */}
        <div className="pt-2 flex justify-center">
          <button
            type="button"
            onClick={handleExportJSON}
            className="btn text-xs py-2 px-5 flex items-center gap-2 cursor-pointer"
          >
            <Download size={15} />
            <span>{dict.profile.statsTab.exportJsonBtn}</span>
          </button>
        </div>

        {/* Footer Disclaimer */}
        <p className="text-[11px] text-mu italic text-center pt-2">
          {dict.profile.statsTab.footerDisclaimer}
        </p>
      </div>
  );
}
