"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, LogIn, MessageSquare, ShieldAlert, Target } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString, formatNumber } from "@/lib/i18n";
import { Sparkline } from "@/components/Sparkline";
import { DEMO_MARKETS, DEMO_EVENTS } from "@/lib/demo-data";
import { ACADEMY_TOPICS } from "@/lib/academy-topics";
import { getDeterministicDailyQuests } from "@/lib/quests";

/** Blocks shared by every visitor of Home (signed in or not). Each renders once per page. */

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function DemoBadge({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-bold text-mu uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded border border-line">
      {label}
    </span>
  );
}

export function MarketMiniCard() {
  const { dict } = useApp();
  const names: Record<string, string> = {
    DXY: dict.market.dxy,
    "S&P 500": dict.market.sp500,
    Nasdaq: dict.market.nasdaq,
    Gold: dict.market.gold,
    Oil: dict.market.oil,
    BTC: dict.market.btc,
  };
  return (
    <div className="card space-y-2.5">
      <div className="flex justify-between items-center">
        <h4 className="h4">{dict.home.marketBlock.title}</h4>
        <DemoBadge label={dict.home.marketBlock.demoBadge} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {DEMO_MARKETS.map((m) => (
          <Link key={m.symbol} href="/market" className="card p-2 text-left hover:border-vi transition-colors">
            <div className="text-[11px] font-semibold text-mu">{names[m.symbol]}</div>
            <div className="mt-1">
              <Sparkline points={m.points} isUp={m.isUp} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CalendarMiniCard() {
  const { dict } = useApp();
  const titles: Record<string, string> = {
    "calendar.cpiUsd": dict.calendar.cpiUsd,
    "calendar.fomcMinutes": dict.calendar.fomcMinutes,
    "calendar.pmiEuro": dict.calendar.pmiEuro,
  };
  const days = dict.home.calendarBlock.days;
  return (
    <div className="card space-y-2.5">
      <div className="flex justify-between items-center">
        <h4 className="h4">{dict.home.calendarBlock.title}</h4>
        <DemoBadge label={dict.home.calendarBlock.demoBadge} />
      </div>
      <div className="space-y-1.5">
        {DEMO_EVENTS.map((ev) => (
          <div key={ev.titleKey} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: ev.color }} />
            <span className="flex-1">{titles[ev.titleKey]}</span>
            <span className="text-mu text-[11px]">{days[ev.dayType]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopicOfDayCard() {
  const { dict, lang } = useApp();
  const topics = Object.values(ACADEMY_TOPICS).filter((t) => t.minorSafe);
  const dayNumber = Math.floor(Date.parse(todayIso()) / 86_400_000);
  const topic = topics[dayNumber % topics.length];
  if (!topic) return null;
  return (
    <div className="card space-y-2">
      <h4 className="h4 flex items-center gap-2">
        <BookOpen size={16} className="text-vi" aria-hidden="true" />
        <span>{dict.publicHome.topicTitle}</span>
      </h4>
      <div className="text-sm font-semibold text-tx">{lang === "ru" ? topic.fallbackTitleRu : topic.fallbackTitleEn}</div>
      <p className="text-xs text-mu">{lang === "ru" ? topic.fallbackDescRu : topic.fallbackDescEn}</p>
      <Link href="/academy" className="inline-block text-xs font-semibold text-vi hover:underline">
        {dict.publicHome.topicLink}
      </Link>
    </div>
  );
}

export function QuestExampleCard() {
  const { dict, lang } = useApp();
  const quest = getDeterministicDailyQuests(todayIso()).core[0];
  if (!quest) return null;
  return (
    <div className="card space-y-2">
      <h4 className="h4 flex items-center gap-2">
        <Target size={16} className="text-vi" aria-hidden="true" />
        <span>{dict.publicHome.questTitle}</span>
      </h4>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-s2/60 p-3 text-xs">
        <span>{lang === "ru" ? quest.fallbackTitleRu : quest.fallbackTitleEn}</span>
        <span className="text-mu whitespace-nowrap">
          {formatString(dict.publicHome.questXp, { xp: formatNumber(lang, quest.xpReward) })} ·{" "}
          {dict.categories[quest.category] || quest.category}
        </span>
      </div>
      <p className="text-[11px] text-mu">{dict.publicHome.questHint}</p>
    </div>
  );
}

export function CommunityFeedCard() {
  const { dict } = useApp();
  return (
    <div className="card space-y-2">
      <h4 className="h4 flex items-center gap-2">
        <MessageSquare size={16} className="text-vi" aria-hidden="true" />
        <span>{dict.publicHome.communityTitle}</span>
      </h4>
      <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-mu">
        {dict.publicHome.communityEmpty}
      </div>
      <Link href="/community" className="inline-block text-xs font-semibold text-vi hover:underline">
        {dict.publicHome.communityLink}
      </Link>
    </div>
  );
}

export function FinancialDisclaimer() {
  const { dict } = useApp();
  return (
    <p className="flex items-center gap-2 text-[11px] text-mu">
      <ShieldAlert size={14} className="shrink-0" aria-hidden="true" />
      <span>
        {dict.publicHome.disclaimer} {dict.publicHome.demoNote}
      </span>
    </p>
  );
}

export function PublicWelcomeCard() {
  const { dict } = useApp();
  return (
    <div className="card bg-gradient-to-r from-s1 via-[#1c1b28] to-s1 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-vi">{dict.publicHome.eyebrow}</div>
      <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl">{dict.publicHome.title}</h1>
      <p className="text-sm text-mu max-w-2xl">{dict.publicHome.description}</p>
    </div>
  );
}

export function SignInPromptCard({ onContinueAsGuest }: { onContinueAsGuest: () => void }) {
  const { dict } = useApp();
  return (
    <div className="card border-vi/40 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-tx">{dict.publicHome.signInTitle}</h2>
        <p className="text-xs text-mu">{dict.publicHome.signInText}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/login"
          className="btn inline-flex min-h-[44px] items-center gap-2 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        >
          <LogIn size={16} aria-hidden="true" />
          <span>{dict.publicHome.signInBtn}</span>
        </Link>
        <button
          type="button"
          onClick={onContinueAsGuest}
          className="min-h-[44px] px-2 text-xs font-semibold text-mu underline-offset-4 hover:text-tx hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi rounded"
        >
          {dict.publicHome.continueGuestLink}
        </button>
      </div>
    </div>
  );
}
