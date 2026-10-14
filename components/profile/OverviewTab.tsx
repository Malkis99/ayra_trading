"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Award, BookOpen, Check, Pencil, Target, Swords, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { xpForNextLevel } from "@/lib/game";
import { TITLES_CATALOG, titleDisplayName } from "@/lib/titles";
import { formatNumber } from "@/lib/i18n";
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
/** Top of the right panel: nickname (serif) with the edit pencil, rank, level with XP to the next level, plan chip. */
function OverviewHeader({ onEditProfile }: { onEditProfile: () => void }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const { authState } = useAuth();
  const h = dict.profile.hero;
  const signedIn = authState === "authenticated";
  const next = xpForNextLevel(gameState.level);
  const pct = Math.min(100, Math.round((gameState.xp / next) * 100));
  const title = TITLES_CATALOG.find((t) => t.id === gameState.selectedTitle) || TITLES_CATALOG[0];
  return (
    <header className="space-y-3 rounded-2xl border border-line bg-s1/70 p-4 sm:p-5" data-testid="overview-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-all font-serif text-3xl font-bold leading-tight text-tx sm:text-4xl" data-testid="profile-nickname">
              {gameState.name}
            </h1>
            <button
              type="button"
              onClick={onEditProfile}
              aria-label={dict.profile.edit.pencil}
              title={dict.profile.edit.pencil}
              className="grid h-9 w-9 place-items-center rounded-lg text-mu transition hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
            {!signedIn && <span className="rounded-md bg-vi/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-vi">{h.guest}</span>}
          </div>
          <p className="mt-1 text-sm font-semibold text-vi">
            <span className="sr-only">{h.rank}: </span>
            {titleDisplayName(dict, title.id)}
          </p>
          {gameState.bio && <p className="mt-2 max-w-prose whitespace-pre-line text-sm text-mu" data-testid="profile-bio">{gameState.bio}</p>}
        </div>
        {signedIn && (
          <Link href="/plans" className="inline-flex min-h-[32px] items-center rounded-lg border border-vi/50 bg-vi/10 px-2.5 text-xs font-semibold text-tx transition hover:bg-vi/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
            ★ {gameState.plan}
          </Link>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-serif text-lg font-semibold text-tx">{formatString(h.level, { level: gameState.level })}</span>
          <span className="text-xs tabular-nums text-mu">{formatString(h.xp, { xp: formatNumber(lang, gameState.xp), next: formatNumber(lang, next), nextLevel: gameState.level + 1 })}</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-s2" role="progressbar" aria-valuemin={0} aria-valuemax={next} aria-valuenow={gameState.xp} aria-label={formatString(h.level, { level: gameState.level })}>
          <div className="h-full rounded-full bg-gradient-to-r from-pri to-vi transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </header>
  );
}

export function OverviewTab({ onOpenAchievements, onEditProfile }: { onOpenAchievements: () => void; onEditProfile: () => void }) {
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
    <div className="space-y-4">
      <OverviewHeader onEditProfile={onEditProfile} />
    <div className="grid grid-cols-1 gap-4 min-[1700px]:grid-cols-2">
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
    </div>
  );
}
