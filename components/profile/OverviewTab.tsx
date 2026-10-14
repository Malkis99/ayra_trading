"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Award, BookOpen, Check, Target, Swords, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { calculateKpis } from "@/lib/journal/overview";
import { getDeterministicDailyQuests } from "@/lib/quests";
import { getIsoDateString } from "@/lib/game";
import { recentAchievements } from "@/lib/profile";
import { formatString } from "@/lib/i18n";
import { cn } from "@/components/ui/cn";

function Block({
  icon: Icon,
  title,
  aside,
  link,
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  aside?: React.ReactNode;
  link?: { href?: string; onClick?: () => void; label: string };
  children: React.ReactNode;
  testId?: string;
}) {
  const linkCls =
    "inline-flex items-center gap-1 text-xs font-semibold text-vi hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi rounded";
  return (
    <section data-testid={testId} className="flex flex-col gap-3 rounded-2xl border border-line bg-s1/70 p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-tx">
          <Icon size={16} className="text-vi" aria-hidden="true" />
          {title}
        </h2>
        {aside}
      </header>
      <div className="flex-1">{children}</div>
      {link &&
        (link.href ? (
          <Link href={link.href} className={linkCls}>
            {link.label}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" onClick={link.onClick} className={cn(linkCls, "self-start")}>
            {link.label}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        ))}
    </section>
  );
}

/** Four compact blocks: trader stats from the Journal, active goals, recent achievements, today's quests. */
export function OverviewTab({ onOpenAchievements }: { onOpenAchievements: () => void }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const { trades, accounts } = useJournal();
  const o = dict.profile.overviewV2;
  const tz = gameState.profile?.timezone || "UTC";

  // Same numbers as the Journal KPI strip for the period "all"
  const k = useMemo(() => calculateKpis(trades, trades, accounts, tz), [trades, accounts, tz]);
  const recent = recentAchievements(gameState, 3);
  const quests = getDeterministicDailyQuests(getIsoDateString(new Date())).core;
  const doneCount = quests.filter((q) => gameState.completedQuestsToday[q.id]).length;
  const ach = dict.profile.achievements as Record<string, string>;

  const tiles = [
    { label: o.trades, value: String(k.tradesCount) },
    { label: o.winRate, value: k.winRate == null ? "—" : `${Math.round(k.winRate * 100)}%` },
    { label: o.process, value: k.processScore == null ? "—" : `${k.processScore}/100` },
    { label: o.cleanDays, value: String(k.cleanDays) },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Block icon={BookOpen} title={o.traderTitle} aside={<span className="text-xs text-mu">{o.traderPeriod}</span>} link={{ href: "/journal", label: o.openJournal }} testId="overview-trader">
        <dl className="grid grid-cols-2 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line/70 bg-s2/40 px-3 py-2.5">
              <dt className="truncate text-[11px] text-mu">{t.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-tx">{t.value}</dd>
            </div>
          ))}
        </dl>
        {k.tradesCount === 0 && <p className="mt-2 text-xs text-mu">{o.noTrades}</p>}
      </Block>

      <Block icon={Target} title={o.goalsTitle} link={{ href: "/quests", label: o.manageGoals }} testId="overview-goals">
        {gameState.customGoals.length === 0 ? (
          <p className="text-sm text-mu">{o.noGoals}</p>
        ) : (
          <ul className="space-y-1.5">
            {gameState.customGoals.slice(0, 4).map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-lg bg-s2/40 px-3 py-2 text-sm text-tx">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-vi" aria-hidden="true" />
                <span className="min-w-0 truncate">{g.title}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block icon={Award} title={o.achievementsTitle} link={{ onClick: onOpenAchievements, label: o.allAchievements }} testId="overview-achievements">
        {recent.length === 0 ? (
          <p className="text-sm text-mu">{o.noAchievements}</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((id) => (
              <li key={id} className="flex items-center gap-2.5 rounded-lg border border-go/30 bg-go/5 px-3 py-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-go/20 text-go" aria-hidden="true">
                  <Award size={14} />
                </span>
                <span className="min-w-0 truncate text-sm font-semibold text-tx">{ach[id]}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block
        icon={Swords}
        title={o.questsTitle}
        aside={<span className="text-xs tabular-nums text-mu">{formatString(o.questsDone, { done: doneCount, total: quests.length })}</span>}
        link={{ href: "/quests", label: o.allQuests }}
        testId="overview-quests"
      >
        <ul className="space-y-1.5">
          {quests.map((q) => {
            const done = !!gameState.completedQuestsToday[q.id];
            return (
              <li key={q.id} className="flex items-center gap-2.5 rounded-lg bg-s2/40 px-3 py-2 text-sm">
                <span
                  className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", done ? "border-vi bg-vi text-ink" : "border-edge")}
                  aria-hidden="true"
                >
                  {done && <Check size={12} strokeWidth={3} />}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", done ? "text-mu line-through" : "text-tx")}>
                  {lang === "ru" ? q.fallbackTitleRu : q.fallbackTitleEn}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-mu">+{q.xpReward} XP</span>
              </li>
            );
          })}
        </ul>
      </Block>
    </div>
  );
}
