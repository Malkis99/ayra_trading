"use client";

import React from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { Plus, CheckSquare, BarChart2 } from "lucide-react";
import { formatString, getPlural, formatNumber } from "@/lib/i18n";

export default function HomePage() {
  const { setAddModalOpen, showToast, userPlan, dict, lang } = useApp();

  const questsWord = getPlural(lang, 10, dict.plurals.quests);

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="card bg-gradient-to-r from-s1 via-[#1c1b28] to-s1">
        <div className="text-xs text-mu">{dict.home.greeting}</div>
        <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl mt-1">
          {dict.home.title}
        </h1>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip">
            {formatString(dict.home.stats.quests, { count: formatNumber(lang, 0) })}
          </span>
          <span className="chip">
            {formatString(dict.home.stats.levelXp, {
              level: formatNumber(lang, 1),
              xp: formatNumber(lang, 0),
              nextXp: formatNumber(lang, 120),
            })}
          </span>
          <span className="chip">
            {formatString(dict.home.stats.coins, { coins: formatNumber(lang, 0) })}
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

      {/* Grid Layout for Dashboard Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column */}
        <div className="space-y-4 lg:col-span-7">
          {/* Daily Quests */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.home.dailyQuests.title}</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs">
                <span>{dict.home.dailyQuests.bias}</span>
                <span className="text-mu">{dict.home.dailyQuests.biasTag}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs">
                <span>{dict.home.dailyQuests.tradeLog}</span>
                <span className="text-mu">{dict.home.dailyQuests.tradeLogTag}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs">
                <span>{dict.home.dailyQuests.reflection}</span>
                <span className="text-mu">{dict.home.dailyQuests.reflectionTag}</span>
              </div>
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
                    current: formatNumber(lang, 0),
                    total: formatNumber(lang, 10),
                  })}
                </span>
              </div>
              <div className="xp">
                <i className="bg-gradient-to-r from-pri to-vi" style={{ width: "0%" }} />
              </div>
            </div>
          </div>

          {/* 7-Day Reward */}
          <div className="card space-y-3">
            <h4 className="h4">{dict.home.dailyReward.title}</h4>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px]">
              {[10, 10, 15, 15, 20, 25, 50].map((coins, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-2 ${
                    idx === 0 ? "border-go bg-go/10 text-go font-bold" : "border-line text-mu"
                  }`}
                >
                  <div>
                    {formatString(dict.home.dailyReward.day, { day: formatNumber(lang, idx + 1) })}
                  </div>
                  <b className="block text-xs mt-0.5">{coins}</b>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                showToast(
                  formatString(dict.home.dailyReward.claimToast, {
                    coins: formatNumber(lang, 10),
                  })
                )
              }
              className="btn w-full text-xs mt-2"
            >
              {dict.home.dailyReward.claim}
            </button>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4 lg:col-span-5">
          {/* Character Mini Card */}
          <div className="card text-center space-y-3">
            <h4 className="h4">{dict.home.characterCard.title}</h4>
            <div className="grid place-items-center h-40 rounded-xl bg-s2/40 border border-line border-dashed">
              <div className="lvbadge text-lg">1</div>
            </div>
            <div>
              <b className="text-sm text-tx">TraderOne</b>
              <div className="text-xs text-mu">
                {formatString(dict.home.characterCard.levelStatus, {
                  level: formatNumber(lang, 1),
                })}
              </div>
            </div>
            <Link href="/profile" className="btn-ghost w-full text-xs block">
              {dict.home.characterCard.openProfile}
            </Link>
          </div>

          {/* AI Brief */}
          <div className="card space-y-2">
            <h4 className="h4">{dict.home.aiBrief.title}</h4>
            {userPlan === "Free" ? (
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
        </div>
      </div>
    </div>
  );
}
