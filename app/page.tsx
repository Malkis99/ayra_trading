"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Plus, CheckSquare, BarChart2 } from "lucide-react";
import { formatString, getPlural, formatNumber } from "@/lib/i18n";
import { Figure } from "@/components/Figure";
import { Sparkline } from "@/components/Sparkline";
import { xpForNextLevel, ChronicleEntry } from "@/lib/game";
import { DEMO_MARKETS, DEMO_EVENTS } from "@/lib/demo-data";
import { getDeterministicDailyQuests } from "@/lib/quests";
import { TITLES, FRAMES, ITEMS } from "@/lib/items";

export default function HomePage() {
  const { setAddModalOpen, showToast, dict, lang } = useApp();
  const { gameState, completeQuest, claimDailyReward, characterStatus } = useGame();

  const [greeting, setGreeting] = useState<string>("");

  useEffect(() => {
    const hr = new Date().getHours();
    if (hr < 12) setGreeting(dict.home.greetings.morning);
    else if (hr < 18) setGreeting(dict.home.greetings.afternoon);
    else setGreeting(dict.home.greetings.evening);
  }, [dict]);

  const completedTodayCount = Object.keys(gameState.completedQuestsToday).length;
  const questsWord = getPlural(lang, 10, dict.plurals.quests);
  const nextLevelXp = xpForNextLevel(gameState.level);
  const xpPercent = Math.min(100, Math.round((gameState.xp / nextLevelXp) * 100));

  const todayIso = new Date().toISOString().split("T")[0];
  const dailyQuests = getDeterministicDailyQuests(todayIso).core;

  const handleQuestClick = (questId: string, fallbackTitle: string, category: string) => {
    if (gameState.completedQuestsToday[questId]) return;
    const res = completeQuest(questId, fallbackTitle, category);
    if (res.leveledUp) {
      showToast(`Level up! Lv ${res.newLevel}`);
    } else {
      showToast("+40 XP · +10 Coins");
    }
  };

  const handleRewardClaim = () => {
    if (gameState.lastRewardClaimDate === todayIso) return;
    const claimedCoins = claimDailyReward();
    if (claimedCoins > 0) {
      showToast(
        formatString(dict.home.dailyReward.claimToast, {
          coins: formatNumber(lang, claimedCoins),
        })
      );
    }
  };

  const isRewardClaimedToday = gameState.lastRewardClaimDate === todayIso;
  const currentRewardDayIndex = gameState.dailyRewardIndex % 7;

  const frameColor = FRAMES[gameState.frame]?.color || "#a38ad1";
  const titleKey = TITLES[gameState.title]?.nameKey;
  const titleText =
    titleKey === "titles.titleNovice"
      ? dict.titles.titleNovice
      : titleKey === "titles.titleDisciplined"
      ? dict.titles.titleDisciplined
      : titleKey === "titles.titleStrategist"
      ? dict.titles.titleStrategist
      : "";

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
          const slotName = (dict.slots as any)[entry.slot] || entry.slot;
          text = formatString(dict.chronicleEvents.itemUnequipped, { name: slotName });
          break;
        }
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
        case "profileUpdated":
          text = dict.chronicleEvents.profileUpdated;
          break;
        case "postPublished":
          text = dict.chronicleEvents.postPublished;
          break;
        case "legacy":
          text = formatString(dict.chronicleEvents.legacy, { text: entry.text });
          break;
        default:
          text = JSON.stringify(entry);
      }
    }

    return (
      <div key={idx} className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-vi flex-none" />
        <span className="truncate">{text}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="card bg-gradient-to-r from-s1 via-[#1c1b28] to-s1">
        <div className="text-xs text-mu">{greeting || dict.home.greetings.afternoon}</div>
        <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl mt-1">
          {formatString(dict.home.title, { name: gameState.name })}
        </h1>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip">
            {formatString(dict.home.stats.quests, {
              count: formatNumber(lang, completedTodayCount),
            })}
          </span>
          <span className="chip">
            {formatString(dict.home.stats.levelXp, {
              level: formatNumber(lang, gameState.level),
              xp: formatNumber(lang, gameState.xp),
              nextXp: formatNumber(lang, nextLevelXp),
            })}
          </span>
          <span className="chip">
            {formatString(dict.home.stats.coins, {
              coins: formatNumber(lang, gameState.coins),
            })}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            onClick={() => setAddModalOpen(true)}
            className="btn text-xs py-2 px-3.5 flex items-center gap-1.5"
          >
            <Plus size={15} />
            <span>{dict.home.quickActions.addTrade}</span>
          </button>
          <Link href="/quests" className="btn-ghost text-xs flex items-center gap-1.5">
            <CheckSquare size={15} />
            <span>{dict.home.quickActions.toQuests}</span>
          </Link>
          <Link href="/market" className="btn-ghost text-xs flex items-center gap-1.5">
            <BarChart2 size={15} />
            <span>{dict.home.quickActions.marketToday}</span>
          </Link>
        </div>
      </div>

      {/* Grid Layout for Dashboard Cards (2 columns on wide screen, 1 column on mobile) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column */}
        <div className="space-y-4 lg:col-span-7">
          {/* Daily Quests */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.home.dailyQuests.title}</h4>
            <div className="space-y-2">
              {dailyQuests.map((q) => {
                const isDone = !!gameState.completedQuestsToday[q.id];
                const title =
                  lang === "ru" ? q.fallbackTitleRu : q.fallbackTitleEn;

                return (
                  <button
                    key={q.id}
                    onClick={() => handleQuestClick(q.id, title, q.category)}
                    className={`w-full text-left flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs transition-colors ${
                      isDone ? "opacity-60 line-through" : "hover:border-vi hover:bg-[#50348f22]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-4 h-4 rounded border border-vi flex items-center justify-center flex-none ${
                          isDone ? "bg-vi text-white" : ""
                        }`}
                      >
                        {isDone && "✓"}
                      </span>
                      <span>{title}</span>
                    </div>
                    <span className="text-mu no-underline">
                      +{q.xpReward} XP · {dict.categories[q.category] || q.category}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2">
              <div className="flex justify-between text-xs text-mu mb-1.5">
                <span>
                  {formatString(dict.home.dailyQuests.challengeTitle, {
                    count: formatNumber(lang, 10),
                    questsWord,
                  })}
                </span>
                <span>
                  {formatString(dict.home.dailyQuests.challengeProgress, {
                    current: formatNumber(lang, Math.min(gameState.weeklyQuestCount, 10)),
                    total: formatNumber(lang, 10),
                  })}
                </span>
              </div>
              <div className="xp">
                <i
                  className="bg-gradient-to-r from-pri to-vi"
                  style={{ width: `${Math.min(100, gameState.weeklyQuestCount * 10)}%` }}
                />
              </div>
            </div>
          </div>

          {/* 7-Day Daily Reward */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.home.dailyReward.title}</h4>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px]">
              {[10, 10, 15, 15, 20, 25, 50].map((coins, idx) => {
                const isPast = idx < currentRewardDayIndex;
                const isToday = idx === currentRewardDayIndex;

                let cardClasses = "border-line text-mu";
                if (isPast) {
                  cardClasses = "border-vi bg-pri/20 text-vi";
                } else if (isToday) {
                  cardClasses = "border-go bg-go/10 text-go font-bold";
                }

                return (
                  <div key={idx} className={`rounded-lg border p-2 ${cardClasses}`}>
                    <div>
                      {formatString(dict.home.dailyReward.day, {
                        day: formatNumber(lang, idx + 1),
                      })}
                    </div>
                    <b className="block text-xs mt-0.5">{coins}</b>
                  </div>
                );
              })}
            </div>
            <button
              onClick={handleRewardClaim}
              disabled={isRewardClaimedToday}
              className="btn w-full text-xs mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRewardClaimedToday
                ? dict.home.dailyReward.alreadyClaimed
                : dict.home.dailyReward.claim}
            </button>
          </div>

          {/* Journal Block */}
          <div className="card space-y-2">
            <h4 className="h4">{dict.home.journalBlock.title}</h4>
            <p className="text-xs text-mu">{dict.home.journalBlock.desc}</p>
            <button
              onClick={() => setAddModalOpen(true)}
              className="btn-ghost text-xs py-2 px-3 inline-flex items-center gap-1.5 mt-1"
            >
              <Plus size={14} />
              <span>{dict.home.journalBlock.addTradeBtn}</span>
            </button>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4 lg:col-span-5">
          {/* Compact Horizontal Character Card */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.home.characterCard.title}</h4>
            <div className="flex items-center gap-4 p-3 rounded-xl bg-s2/60 border border-line">
              {/* Figure Stage / Pedestal */}
              <div
                className="relative flex-none w-24 h-32 rounded-xl grid place-items-center bg-radial-gradient from-pri/50 via-s1 to-s1 overflow-hidden border"
                style={{ borderColor: frameColor }}
              >
                <div className="absolute inset-0 bg-radial-gradient from-vi/20 to-transparent pointer-events-none" />
                <Figure equipment={gameState.equipment} width={64} height={110} />
                {/* Pedestal Ring */}
                <div className="absolute bottom-1 w-16 h-3 rounded-full border border-vi/60 bg-vi/20" />
              </div>

              {/* Character Info */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center justify-between">
                  <b className="text-sm font-bold text-tx truncate">{gameState.name}</b>
                  <span className="text-[11px] font-semibold text-go">
                    Lv {gameState.level}
                  </span>
                </div>

                <div className="text-xs text-mu flex items-center gap-1.5">
                  <span>
                    {characterStatus === "Training"
                      ? dict.home.characterCard.status.training
                      : dict.home.characterCard.status.resting}
                  </span>
                  {titleText && <span>· {titleText}</span>}
                </div>

                {/* XP Progress Bar */}
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[10px] text-mu">
                    <span>XP</span>
                    <span>
                      {gameState.xp} / {nextLevelXp}
                    </span>
                  </div>
                  <div className="xp h-1.5 bg-white/10">
                    <i className="block h-full bg-vi" style={{ width: `${xpPercent}%` }} />
                  </div>
                </div>

                <Link
                  href="/profile"
                  className="btn-ghost text-[11px] py-1 px-2.5 inline-block text-center w-full mt-2"
                >
                  {dict.home.characterCard.openProfile}
                </Link>
              </div>
            </div>
          </div>

          {/* Markets Mini Cards */}
          <div className="card space-y-2.5">
            <div className="flex justify-between items-center">
              <h4 className="h4">{dict.home.marketBlock.title}</h4>
              <span className="text-[10px] font-bold text-mu uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded border border-line">
                {dict.home.marketBlock.demoBadge}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_MARKETS.map((m) => {
                const name =
                  m.symbol === "DXY"
                    ? dict.market.dxy
                    : m.symbol === "S&P 500"
                    ? dict.market.sp500
                    : m.symbol === "Nasdaq"
                    ? dict.market.nasdaq
                    : m.symbol === "Gold"
                    ? dict.market.gold
                    : m.symbol === "Oil"
                    ? dict.market.oil
                    : dict.market.btc;
                return (
                  <Link
                    key={m.symbol}
                    href="/market"
                    className="card p-2 text-left hover:border-vi transition-colors"
                  >
                    <div className="text-[11px] font-semibold text-mu">{name}</div>
                    <div className="mt-1">
                      <Sparkline points={m.points} isUp={m.isUp} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Calendar Mini Block */}
          <div className="card space-y-2.5">
            <div className="flex justify-between items-center">
              <h4 className="h4">{dict.home.calendarBlock.title}</h4>
              <span className="text-[10px] font-bold text-mu uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded border border-line">
                {dict.home.calendarBlock.demoBadge}
              </span>
            </div>
            <div className="space-y-1.5">
              {DEMO_EVENTS.map((ev, i) => {
                const title =
                  ev.titleKey === "calendar.cpiUsd"
                    ? dict.calendar.cpiUsd
                    : ev.titleKey === "calendar.fomcMinutes"
                    ? dict.calendar.fomcMinutes
                    : dict.calendar.pmiEuro;
                const dayLabel =
                  ev.dayType === "today"
                    ? dict.home.calendarBlock.days.today
                    : ev.dayType === "tomorrow"
                    ? dict.home.calendarBlock.days.tomorrow
                    : dict.home.calendarBlock.days.friday;

                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2 h-2 rounded-full flex-none"
                      style={{ backgroundColor: ev.color }}
                    />
                    <span className="flex-1">{title}</span>
                    <span className="text-mu text-[11px]">{dayLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Brief */}
          <div className="card space-y-2">
            <h4 className="h4">{dict.home.aiBrief.title}</h4>
            {gameState.plan === "Free" ? (
              <>
                <p className="text-xs text-mu">{dict.home.aiBrief.freeText}</p>
                <Link
                  href="/plans"
                  className="text-xs font-semibold text-go hover:underline block pt-1"
                >
                  {dict.home.aiBrief.viewPlans}
                </Link>
              </>
            ) : (
              <p className="text-xs text-mu">{dict.home.aiBrief.paidText}</p>
            )}
          </div>

          {/* Chronicle Block */}
          <div className="card space-y-2">
            <h4 className="h4">{dict.home.chronicleBlock.title}</h4>
            <div className="space-y-1.5 text-xs text-mu">
              {gameState.chronicle.slice(0, 4).map(renderChronicleItem)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
