"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Plus, CheckSquare, BarChart2 } from "lucide-react";
import { formatString, getPlural, formatNumber } from "@/lib/i18n";
import { Figure } from "@/components/Figure";
import { Sparkline } from "@/components/Sparkline";
import { xpForNextLevel, DAILY_REWARDS } from "@/lib/game";
import { DEMO_MARKETS, DEMO_EVENTS } from "@/lib/demo-data";

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

  const questList = [
    {
      title: dict.home.dailyQuests.bias,
      tag: dict.home.dailyQuests.biasTag,
    },
    {
      title: dict.home.dailyQuests.tradeLog,
      tag: dict.home.dailyQuests.tradeLogTag,
    },
    {
      title: dict.home.dailyQuests.reflection,
      tag: dict.home.dailyQuests.reflectionTag,
    },
  ];

  const handleQuestClick = (index: number, title: string) => {
    if (gameState.completedQuestsToday[index]) return;
    const res = completeQuest(index, title);
    if (res.leveledUp) {
      showToast(`Level up! Lv ${res.newLevel}`);
    } else {
      showToast("+40 XP · +10 Coins");
    }
  };

  const handleRewardClaim = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    if (gameState.lastRewardClaimDate === todayStr) return;
    const claimedCoins = claimDailyReward();
    if (claimedCoins > 0) {
      showToast(
        formatString(dict.home.dailyReward.claimToast, {
          coins: formatNumber(lang, claimedCoins),
        })
      );
    }
  };

  const todayStr = new Date().toISOString().split("T")[0];
  const isRewardClaimedToday = gameState.lastRewardClaimDate === todayStr;
  const currentRewardDayIndex = gameState.dailyRewardIndex % 7;

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
              {questList.map((q, idx) => {
                const isDone = !!gameState.completedQuestsToday[idx];
                return (
                  <button
                    key={idx}
                    onClick={() => handleQuestClick(idx, q.title)}
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
                      <span>{q.title}</span>
                    </div>
                    <span className="text-mu no-underline">{q.tag}</span>
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
              {DAILY_REWARDS.map((coins, idx) => {
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
              <span>{dict.home.journalBlock.addTradeBtn}</span>
            </button>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4 lg:col-span-5">
          {/* Character Mini Card */}
          <div className="card text-center space-y-3">
            <h4 className="h4">{dict.home.characterCard.title}</h4>
            <div className="grid place-items-center h-44 rounded-xl bg-gradient-radial from-pri/40 via-transparent to-transparent border border-line">
              <Figure equipment={gameState.equipment} width={90} height={170} />
            </div>
            <div>
              <b className="text-sm text-tx">{gameState.name}</b>
              <div className="text-xs text-mu mt-0.5">
                Lv {gameState.level} ·{" "}
                {characterStatus === "Training"
                  ? dict.home.characterCard.status.training
                  : dict.home.characterCard.status.resting}
              </div>
            </div>
            <Link href="/profile" className="btn-ghost w-full text-xs block py-2">
              {dict.home.characterCard.openProfile}
            </Link>
          </div>

          {/* Markets Mini Cards */}
          <div className="card space-y-2.5">
            <div className="flex justify-between items-center">
              <h4 className="h4">{dict.home.marketBlock.title}</h4>
              <span className="text-[10px] text-mu uppercase tracking-wider">
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
              <span className="text-[10px] text-mu uppercase tracking-wider">
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
              {gameState.chronicle.slice(0, 4).map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-vi flex-none" />
                  <span className="truncate">{entry}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
